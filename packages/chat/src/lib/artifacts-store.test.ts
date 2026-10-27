import assert from "node:assert/strict"
import { test } from "node:test"
import type { Artifact, ArtifactLoadParams, ArtifactPage } from "./artifacts.ts"
import { ArtifactsStore } from "./artifacts-store.ts"
import { artifact } from "./artifact-test-helpers.ts"

function page(items: Artifact[], extra: Partial<ArtifactPage> & { next?: string | null } = {}): ArtifactPage {
  const { next = null, ...rest } = extra
  return { sessionId: "s1", epoch: "e1", throughSequence: 10, extractorVersion: 1, items, page: { nextCursor: next }, ...rest }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(res => { resolve = res })
  return { promise, resolve }
}

const tick = () => new Promise<void>(resolve => setImmediate(resolve))

function scripted(responses: Array<ArtifactPage | Error | Promise<ArtifactPage>>) {
  const calls: ArtifactLoadParams[] = []
  const load = async (params: ArtifactLoadParams) => {
    calls.push(params)
    const next = responses.shift()
    if (!next) throw new Error("unexpected load")
    if (next instanceof Error) throw next
    return next
  }
  return { load, calls }
}

test("initial load pages through nextCursor at limit 500", async () => {
  const { load, calls } = scripted([
    page([artifact({ key: "a", sequence: 3 })], { next: "c1", throughSequence: 12 }),
    page([artifact({ key: "b", sequence: 2 })], { next: "c2", throughSequence: 13 }),
    page([artifact({ key: "c", sequence: 1 })], { throughSequence: 14 }),
  ])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  await store.idle()
  assert.deepEqual(calls, [{ limit: 500 }, { limit: 500, cursor: "c1" }, { limit: 500, cursor: "c2" }])
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.status, "ready")
  assert.deepEqual(snapshot.items.map(item => item.key), ["a", "b", "c"])
  // The lowest watermark seen while paging, so a delta re-reads anything that landed between pages.
  assert.equal(snapshot.throughSequence, 12)
})

test("nothing loads while disabled; enabling loads once", async () => {
  const { load, calls } = scripted([page([artifact({ key: "a" })])])
  const store = new ArtifactsStore(load)
  await store.refresh()
  assert.equal(calls.length, 0)
  assert.equal(store.getSnapshot().status, "idle")
  store.setEnabled(true)
  await store.idle()
  assert.equal(calls.length, 1)
  assert.equal(store.getSnapshot().status, "ready")
})

test("refresh reads a delta from throughSequence and merges by key", async () => {
  const { load, calls } = scripted([
    page([artifact({ key: "a", sequence: 1 }), artifact({ key: "b", sequence: 2 })], { throughSequence: 10 }),
    page([artifact({ key: "a", sequence: 11, occurrences: 2 }), artifact({ key: "c", sequence: 12 })], { throughSequence: 12 }),
  ])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  await store.idle()
  await store.refresh()
  assert.deepEqual(calls[1], { sinceSequence: 10, limit: 500 })
  const snapshot = store.getSnapshot()
  assert.deepEqual(snapshot.items.map(item => item.key), ["c", "a", "b"])
  assert.equal(snapshot.items.find(item => item.key === "a")!.occurrences, 2)
  assert.equal(snapshot.throughSequence, 12)
})

test("a delta overlapping history never duplicates", async () => {
  const same = artifact({ key: "a", sequence: 5 })
  const { load } = scripted([
    page([same], { throughSequence: 5 }),
    page([same], { throughSequence: 5 }),
    page([same], { throughSequence: 5 }),
  ])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  await store.idle()
  await store.refresh()
  await store.refresh()
  assert.equal(store.getSnapshot().items.length, 1)
})

test("concurrent refreshes coalesce into one in flight and one trailing", async () => {
  const first = deferred<ArtifactPage>()
  const delta = deferred<ArtifactPage>()
  const trailing = deferred<ArtifactPage>()
  const { load, calls } = scripted([first.promise, delta.promise, trailing.promise])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  const initial = store.idle()
  first.resolve(page([artifact({ key: "a", sequence: 1 })], { throughSequence: 1 }))
  await initial
  const a = store.refresh()
  const b = store.refresh()
  const c = store.refresh()
  await tick()
  assert.equal(calls.length, 2, "only the delta is in flight")
  delta.resolve(page([artifact({ key: "b", sequence: 2 })], { throughSequence: 2 }))
  await tick()
  await tick()
  assert.equal(calls.length, 3, "exactly one trailing read for the three callers")
  assert.deepEqual(calls[2], { sinceSequence: 2, limit: 500 })
  trailing.resolve(page([artifact({ key: "c", sequence: 3 })], { throughSequence: 3 }))
  await Promise.all([a, b, c])
  assert.deepEqual(store.getSnapshot().items.map(item => item.key), ["c", "b", "a"])
})

test("a refresh requested during the initial load runs as a delta afterwards", async () => {
  const first = deferred<ArtifactPage>()
  const { load, calls } = scripted([
    first.promise,
    page([artifact({ key: "late", sequence: 4 })], { throughSequence: 4 }),
  ])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  const initial = store.idle()
  const requested = store.refresh()
  first.resolve(page([artifact({ key: "a", sequence: 1 })], { throughSequence: 1 }))
  await Promise.all([initial, requested])
  assert.deepEqual(calls[1], { sinceSequence: 1, limit: 500 })
  assert.deepEqual(store.getSnapshot().items.map(item => item.key), ["late", "a"])
})

test("a response with a different epoch discards everything and reloads", async () => {
  const { load, calls } = scripted([
    page([artifact({ key: "old", sequence: 5 })], { epoch: "e1", throughSequence: 5 }),
    page([], { epoch: "e2", throughSequence: 0 }),
    page([artifact({ key: "new", sequence: 1 })], { epoch: "e2", throughSequence: 1 }),
  ])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  await store.idle()
  await store.refresh()
  assert.deepEqual(calls[2], { limit: 500 }, "the reload is a full read, not a delta")
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.epoch, "e2")
  assert.deepEqual(snapshot.items.map(item => item.key), ["new"])
})

test("an epoch change between initial pages restarts the load", async () => {
  const { load } = scripted([
    page([artifact({ key: "old", sequence: 5 })], { epoch: "e1", next: "c1" }),
    page([artifact({ key: "x", sequence: 1 })], { epoch: "e2" }),
    page([artifact({ key: "fresh", sequence: 2 })], { epoch: "e2", next: null }),
  ])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  await store.idle()
  assert.equal(store.getSnapshot().epoch, "e2")
  assert.deepEqual(store.getSnapshot().items.map(item => item.key), ["fresh"])
})

test("a failed initial load is an error that reload recovers from; partial data is not kept", async () => {
  const { load } = scripted([
    page([artifact({ key: "a", sequence: 1 })], { next: "c1" }),
    new Error("boom"),
    page([artifact({ key: "a", sequence: 1 }), artifact({ key: "b", sequence: 2 })]),
  ])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  await store.idle()
  assert.equal(store.getSnapshot().status, "error")
  assert.equal(store.getSnapshot().error, "boom")
  assert.deepEqual(store.getSnapshot().items, [])
  await store.reload()
  assert.equal(store.getSnapshot().status, "ready")
  assert.equal(store.getSnapshot().items.length, 2)
})

test("a failed delta keeps what is shown", async () => {
  const { load } = scripted([page([artifact({ key: "a", sequence: 1 })]), new Error("offline")])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  await store.idle()
  await store.refresh()
  const snapshot = store.getSnapshot()
  assert.equal(snapshot.status, "ready")
  assert.equal(snapshot.error, "offline")
  assert.equal(snapshot.items.length, 1)
})

test("reload during a read discards the stale result", async () => {
  const stale = deferred<ArtifactPage>()
  const { load } = scripted([stale.promise, page([artifact({ key: "fresh", sequence: 2 })])])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  const first = store.idle()
  const reloaded = store.reload()
  stale.resolve(page([artifact({ key: "stale", sequence: 1 })]))
  await Promise.all([first, reloaded])
  assert.deepEqual(store.getSnapshot().items.map(item => item.key), ["fresh"])
})

test("disabling abandons an initial load; re-enabling starts clean", async () => {
  const slow = deferred<ArtifactPage>()
  const { load } = scripted([slow.promise, page([artifact({ key: "a", sequence: 1 })])])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  store.setEnabled(false)
  assert.equal(store.getSnapshot().status, "idle")
  slow.resolve(page([artifact({ key: "ghost", sequence: 9 })]))
  await tick()
  assert.equal(store.getSnapshot().items.length, 0)
  store.setEnabled(true)
  await store.idle()
  assert.deepEqual(store.getSnapshot().items.map(item => item.key), ["a"])
})

test("re-enabling a loaded store catches up with a delta", async () => {
  const { load, calls } = scripted([
    page([artifact({ key: "a", sequence: 1 })], { throughSequence: 1 }),
    page([artifact({ key: "b", sequence: 2 })], { throughSequence: 2 }),
  ])
  const store = new ArtifactsStore(load)
  store.setEnabled(true)
  await store.idle()
  store.setEnabled(false)
  store.setEnabled(true)
  await store.idle()
  assert.deepEqual(calls[1], { sinceSequence: 1, limit: 500 })
  assert.deepEqual(store.getSnapshot().items.map(item => item.key), ["b", "a"])
})

test("subscribers are notified", async () => {
  const { load } = scripted([page([artifact({ key: "a" })])])
  const store = new ArtifactsStore(load)
  let notifications = 0
  store.subscribe(() => { notifications++ })
  store.setEnabled(true)
  await store.idle()
  assert.ok(notifications >= 2)
})
