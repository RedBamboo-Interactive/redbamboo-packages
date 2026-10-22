import assert from "node:assert/strict"
import { test } from "node:test"
import {
  entityTypeLabel,
  mergeEntityPickerSource,
  needsResolve,
  pluralizeLabel,
  readResolution,
  resolveFromSearch,
  retryDelay,
  settleResolution,
} from "./components/entity-picker-core.ts"

const item = (id, name, slug) => ({ entity: { id, typeSlug: "agent", name }, slug })
const signal = new AbortController().signal

function fakeProvider(log) {
  return {
    search: async (request) => { log.push(`provider.search:${request.query}`); return [item("a1", "Nova", "nova")] },
    resolve: async (request) => { log.push(`provider.resolve:${request.id}`); return item("a1", "Nova", "nova") },
    subscribe: (type) => { log.push(`provider.subscribe:${type}`); return () => {} },
  }
}

test("no override uses the provider as is", () => {
  const provider = fakeProvider([])
  assert.equal(mergeEntityPickerSource(provider, () => undefined), provider)
  assert.equal(mergeEntityPickerSource(null, () => undefined), null)
})

test("a search override keeps the provider's resolve and subscribe", async () => {
  const log = []
  const provider = fakeProvider(log)
  const override = { search: async (request) => { log.push(`override.search:${request.query}`); return [item("c1", "Secret", "secret")] } }
  const merged = mergeEntityPickerSource(provider, () => override)
  assert.deepEqual((await merged.search({ type: "agent", query: "se", limit: 10 }, signal)).map((i) => i.entity.id), ["c1"])
  await merged.resolve({ type: "agent", id: "a1" }, signal)
  merged.subscribe("agent", () => {})
  assert.deepEqual(log, ["override.search:se", "provider.resolve:a1", "provider.subscribe:agent"])
})

test("override methods are read at call time, so inline functions stay current", async () => {
  let generation = 1
  const merged = mergeEntityPickerSource(fakeProvider([]), () => ({
    search: async () => [item(`g${generation}`, "Gen", undefined)],
  }))
  assert.equal((await merged.search({ type: "agent", query: "", limit: 5 }, signal))[0].entity.id, "g1")
  generation = 2
  assert.equal((await merged.search({ type: "agent", query: "", limit: 5 }, signal))[0].entity.id, "g2")
})

test("without a provider, resolve falls back to listing through search", async () => {
  const merged = mergeEntityPickerSource(null, () => ({
    search: async (request) => {
      assert.equal(request.query, "")
      return [item("a1", "Nova", "nova"), item("a2", "Orion", "orion")]
    },
  }))
  assert.equal((await merged.resolve({ type: "agent", id: "orion" }, signal)).entity.id, "a2")
  assert.equal(await merged.resolve({ type: "agent", id: "ghost" }, signal), null)
  assert.equal(merged.subscribe, undefined)
  assert.equal(mergeEntityPickerSource(null, () => ({ resolve: async () => null })), null, "nothing can search")
})

test("resolveFromSearch prefers an exact id over a slug collision", async () => {
  const found = await resolveFromSearch(async () => [item("x", "Slug twin", "a2"), item("a2", "Orion", "orion")], { type: "agent", id: "a2" }, signal)
  assert.equal(found.entity.name, "Orion")
})

test("a revision bump keeps the resolved item visible until the new answer lands", () => {
  const first = {}
  const second = {}
  const nova = item("a1", "Nova", "nova")
  const entry = settleResolution(undefined, first, { item: nova })
  assert.equal(needsResolve(entry, first), false)
  assert.equal(needsResolve(entry, second), true, "new epoch revalidates")
  assert.deepEqual(readResolution(entry, undefined, true), { status: "resolved", item: nova }, "stale item still shown")
  const renamed = item("a1", "Nova Prime", "nova")
  assert.equal(readResolution(settleResolution(entry, second, { item: renamed }), undefined, true).item.entity.name, "Nova Prime")
})

test("failures are not cached as missing and keep the last answer", () => {
  const epoch = {}
  const failed = settleResolution(undefined, epoch, { error: "502 Bad Gateway" })
  assert.equal(failed.item, undefined)
  assert.equal(failed.failures, 1)
  assert.equal(needsResolve(failed, epoch), true, "retried even within the same epoch")
  assert.deepEqual(readResolution(failed, undefined, true), { status: "error", error: "502 Bad Gateway" })

  const nova = item("a1", "Nova", "nova")
  const resolved = settleResolution(undefined, epoch, { item: nova })
  const staleAfterError = settleResolution(resolved, {}, { error: "timeout" })
  assert.equal(staleAfterError.item, nova)
  assert.deepEqual(readResolution(staleAfterError, undefined, true), { status: "resolved", item: nova })

  const recovered = settleResolution(failed, epoch, { item: null })
  assert.equal(recovered.failures, 0)
  assert.deepEqual(readResolution(recovered, undefined, true), { status: "missing" }, "only an authoritative null is missing")
})

test("loading only when nothing has ever been known", () => {
  const nova = item("a1", "Nova", "nova")
  assert.deepEqual(readResolution(undefined, undefined, true), { status: "loading" })
  assert.deepEqual(readResolution(undefined, nova, true), { status: "resolved", item: nova })
  assert.deepEqual(readResolution(undefined, undefined, false), { status: "missing" })
})

test("retry backoff doubles and caps", () => {
  assert.deepEqual([1, 2, 3, 4, 6, 20].map(retryDelay), [1000, 2000, 4000, 8000, 30000, 30000])
})

test("type labels read naturally", () => {
  assert.equal(entityTypeLabel("voice-preset"), "voice preset")
  assert.deepEqual(["agent", "category", "box", "match", "day"].map(pluralizeLabel), ["agents", "categories", "boxes", "matches", "days"])
})
