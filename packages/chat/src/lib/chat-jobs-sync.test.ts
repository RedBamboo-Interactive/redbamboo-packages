import { test } from "node:test"
import assert from "node:assert/strict"
import type { ComputeJobRecord } from "./chat-jobs.ts"
import { ChatJobsSync, type ChatJobsTransport } from "./chat-jobs-sync.ts"

/** A clock and timer queue the test advances by hand. */
function fakeTime(start = Date.parse("2026-11-16T14:00:00Z")) {
  let now = start
  let nextId = 1
  const timers = new Map<number, { at: number; callback: () => void }>()
  return {
    now: () => now,
    setTimer: (callback: () => void, ms: number) => { const id = nextId++; timers.set(id, { at: now + ms, callback }); return id },
    clearTimer: (id: unknown) => { timers.delete(id as number) },
    pending: () => timers.size,
    async advance(ms: number) {
      const until = now + ms
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= until).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        timers.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].callback()
        await settle()
      }
      now = until
      await settle()
    },
  }
}
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

function recordingTransport(initial: Record<string, ComputeJobRecord> = {}) {
  const store = new Map(Object.entries(initial))
  const calls: string[] = []
  const transport: ChatJobsTransport = {
    async list(window) {
      calls.push(`list ${window.since}${window.until ? ` ${window.until}` : ""}`)
      return [...store.values()].filter(job => {
        const queued = Date.parse(job.queuedAt ?? "")
        return queued >= Date.parse(window.since) && (!window.until || queued < Date.parse(window.until))
      })
    },
    async get(id) {
      calls.push(`get ${id}`)
      return store.get(id) ?? null
    },
  }
  return { transport, store, calls }
}

const job = (id: string, queuedAt: string, fields: Partial<ComputeJobRecord> = {}): ComputeJobRecord => ({
  id, capability: "image-gen", status: "Running", progress: 0, queuedAt, ...fields,
})

function setup(initial: Record<string, ComputeJobRecord>, extra: Partial<ConstructorParameters<typeof ChatJobsSync>[0]> = {}) {
  const time = fakeTime()
  const { transport, store, calls } = recordingTransport(initial)
  let latest: ComputeJobRecord[] = []
  const sync = new ChatJobsSync({
    transport, onChange: records => { latest = records },
    now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer, ...extra,
  })
  return { sync, time, store, calls, latest: () => latest }
}

test("opens with one bounded list and nothing else while nothing runs", async () => {
  const { sync, time, calls, latest } = setup({ done: job("done", "2026-11-16T13:00:00Z", { status: "Completed" }) })
  sync.setSince("2026-11-16T12:00:00Z")
  await time.advance(60_000)
  assert.deepEqual(calls, ["list 2026-11-16T12:00:00Z"])
  assert.equal(latest().length, 1)
  sync.frame("job.updated", { id: "done", status: "Completed" })
  await time.advance(60_000)
  assert.deepEqual(calls, ["list 2026-11-16T12:00:00Z"], "a terminal job is never re-read")
  assert.equal(time.pending(), 0, "no poll without running work")
  sync.dispose()
})

test("frames for a running job re-read it alone, coalesced to one read per second", async () => {
  const { sync, time, store, calls, latest } = setup({ run: job("run", "2026-11-16T13:00:00Z") })
  sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  for (let i = 0; i < 10; i++) sync.frame("job.updated", { id: "run", status: "Running", progress: i / 10 })
  store.set("run", job("run", "2026-11-16T13:00:00Z", { progress: 0.5 }))
  await time.advance(999)
  assert.deepEqual(calls.filter(call => call.startsWith("get")), ["get run"], "ten frames, one read")
  assert.equal(latest()[0].progress, 0.5)
  await time.advance(2000)
  sync.frame("job.event", { jobId: "run" })
  await time.advance(0)
  assert.equal(calls.filter(call => call.startsWith("get")).length, 2, "an idle interval reads at once")
  for (let i = 0; i < 5; i++) sync.frame("job.event", { jobId: "run" })
  await time.advance(999)
  assert.equal(calls.filter(call => call.startsWith("get")).length, 2, "the next read waits for the interval")
  await time.advance(1)
  assert.equal(calls.filter(call => call.startsWith("get")).length, 3)
  assert.ok(!calls.slice(1).some(call => call.startsWith("list")), "never a re-list to refresh")
  sync.dispose()
})

test("the payload is never rendered: only the authorized read is", async () => {
  const { sync, time, latest } = setup({ run: job("run", "2026-11-16T13:00:00Z", { name: "Covers" }) })
  sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  sync.frame("job.updated", { id: "run", status: "Completed", name: "Injected", progress: 1 })
  await time.advance(1000)
  assert.equal(latest()[0].name, "Covers")
  assert.equal(latest()[0].status, "Running")
  sync.dispose()
})

test("an unknown job that may be ours triggers a short discovery list; others and excluded ones don't", async () => {
  const mayConcern = (data: Record<string, unknown>) => data.discussion === "d1"
  const { sync, time, store, calls, latest } = setup({}, { mayConcern })
  sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  sync.frame("job.created", { id: "other", discussion: "d2" })
  sync.frame("job.created", { id: "turn", capabilitySlug: "ai-session", discussion: "d1" })
  await time.advance(5000)
  assert.deepEqual(calls, ["list 2026-11-16T12:00:00Z"])
  store.set("new", job("new", "2026-11-16T14:00:03Z"))
  sync.frame("job.created", { id: "new", capabilitySlug: "image-gen", discussion: "d1" })
  sync.frame("job.updated", { id: "new", capabilitySlug: "image-gen", discussion: "d1" })
  await time.advance(1000)
  const lists = calls.filter(call => call.startsWith("list"))
  assert.equal(lists.length, 2, "two frames, one discovery")
  assert.ok(Date.parse(lists[1].slice(5)) >= Date.parse("2026-11-16T13:58:00Z"), "discovery reads from the last list on, not the whole window")
  assert.deepEqual(latest().map(record => record.id), ["new"])
  sync.dispose()
})

test("content-free confidential frames re-read only in a confidential conversation", async () => {
  const open = setup({}, { mayConcern: () => true })
  open.sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  open.sync.frame("job.updated", { id: "secret", status: "Queued", confidential: true })
  await open.time.advance(2000)
  assert.equal(open.calls.length, 1)
  open.sync.dispose()

  const closed = setup({}, { confidential: true })
  closed.sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  closed.sync.frame("job.updated", { id: "secret", status: "Queued", confidential: true })
  await closed.time.advance(2000)
  assert.equal(closed.calls.filter(call => call.startsWith("list")).length, 2)
  closed.sync.dispose()
})

test("an older page lists only its own window", async () => {
  const { sync, time, calls, latest } = setup({
    old: job("old", "2026-11-15T09:00:00Z", { status: "Completed" }),
    recent: job("recent", "2026-11-16T13:00:00Z", { status: "Completed" }),
  })
  sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  assert.deepEqual(latest().map(record => record.id), ["recent"])
  sync.setSince("2026-11-16T12:30:00Z")
  sync.setSince("2026-11-15T08:00:00Z")
  await time.advance(10)
  assert.deepEqual(calls, ["list 2026-11-16T12:00:00Z", "list 2026-11-15T08:00:00Z 2026-11-16T12:00:00Z"])
  assert.deepEqual(latest().map(record => record.id).sort(), ["old", "recent"])
  sync.dispose()
})

test("while something runs a slow poll re-reads it; it stops once nothing runs", async () => {
  const { sync, time, store, calls } = setup({ run: job("run", "2026-11-16T13:00:00Z") })
  sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  await time.advance(15_000)
  await time.advance(1000)
  assert.deepEqual(calls.filter(call => call.startsWith("get")), ["get run"])
  store.set("run", job("run", "2026-11-16T13:00:00Z", { status: "Completed" }))
  await time.advance(16_000)
  assert.equal(calls.filter(call => call.startsWith("get")).length, 2)
  await time.advance(120_000)
  assert.equal(calls.filter(call => call.startsWith("get")).length, 2, "no reads once it is done")
  assert.equal(time.pending(), 0)
  sync.dispose()
})

test("reconnect re-reads running jobs and lists from the last list on", async () => {
  const { sync, time, store, calls, latest } = setup({ run: job("run", "2026-11-16T13:00:00Z") })
  sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  store.set("run", job("run", "2026-11-16T13:00:00Z", { status: "Failed", errorMessage: "RedCompute restarted" }))
  sync.reconnected()
  await time.advance(1000)
  assert.deepEqual(calls.slice(1).map(call => call.split(" ")[0]).sort(), ["get", "list"])
  assert.equal(latest()[0].status, "Failed", "a job lost to a restart reads failed")
  sync.dispose()
})

test("a job that is gone or no longer this conversation's leaves; a duplicate stays one", async () => {
  const { sync, time, store, latest } = setup({ run: job("run", "2026-11-16T13:00:00Z") })
  sync.setSince("2026-11-16T12:00:00Z")
  await settle()
  sync.setSince("2026-11-16T11:00:00Z")
  await time.advance(10)
  assert.equal(latest().length, 1, "the same job from two lists renders once")
  store.delete("run")
  sync.frame("job.updated", { id: "run" })
  await time.advance(1000)
  assert.equal(latest().length, 0)
  sync.dispose()
})

test("disposed: no further reads or timers", async () => {
  const { sync, time, calls } = setup({ run: job("run", "2026-11-16T13:00:00Z") })
  sync.dispose()
  sync.setSince("2026-11-16T12:00:00Z")
  sync.frame("job.updated", { id: "run" })
  sync.reconnected()
  await time.advance(60_000)
  assert.deepEqual(calls, [])
  assert.equal(time.pending(), 0)
})

test("frames that arrive while a discovery is in flight don't ask again, and an id the endpoint drops doesn't loop", async () => {
  const time = fakeTime()
  const store = new Map<string, ComputeJobRecord>()
  const calls: string[] = []
  let release: (() => void) | null = null
  const transport: ChatJobsTransport = {
    async list(window) {
      calls.push(`list ${window.since}`)
      if (calls.length > 1) await new Promise<void>(resolve => { release = resolve })
      return [...store.values()]
    },
    async get(id) { calls.push(`get ${id}`); return store.get(id) ?? null },
  }
  const sync = new ChatJobsSync({
    transport, onChange: () => {}, mayConcern: () => true,
    now: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
  })
  sync.setSince("2026-11-16T13:00:00Z")
  await time.advance(10)

  store.set("new", job("new", "2026-11-16T14:00:00Z"))
  sync.frame("job.created", { id: "new", capabilitySlug: "image-gen" })
  await time.advance(1000)
  assert.equal(calls.filter(call => call.startsWith("list")).length, 2, "one discovery")
  // The same job's next frames, and one the endpoint will never return, arrive mid-list.
  sync.frame("job.updated", { id: "new", capabilitySlug: "image-gen" })
  sync.frame("job.created", { id: "foreign", capabilitySlug: "image-gen" })
  release!()
  await time.advance(1000)
  assert.equal(calls.filter(call => call.startsWith("list")).length, 3, "the foreign id gets its own single look")
  release!()
  await time.advance(5000)
  for (let i = 0; i < 5; i++) {
    sync.frame("job.updated", { id: "foreign", capabilitySlug: "image-gen", progress: i / 5 })
    await time.advance(1000)
  }
  assert.equal(calls.filter(call => call.startsWith("list")).length, 3, "its progress frames never list again")
  sync.frame("job.updated", { id: "new", capabilitySlug: "image-gen" })
  await time.advance(1000)
  assert.ok(calls.at(-1) === "get new", "a known job is re-read alone")
  sync.dispose()
})
