import assert from "node:assert/strict"
import test from "node:test"
import { MaintenanceStatusReader, type MaintenanceStatusSnapshot } from "./maintenance-status-reader.ts"

const draining = { state: "draining", paused: true, runId: "r1", startedAt: "2026-11-13T10:00:00Z", changedAt: "2026-11-13T10:00:01Z", activeTurnCount: 2 }
const idle = { state: "idle", paused: false, runId: null, startedAt: null, changedAt: "2026-11-13T10:05:00Z", activeTurnCount: 0 }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

test("a read publishes the parsed status through the injected loader", async () => {
  const published: MaintenanceStatusSnapshot[] = []
  const reader = new MaintenanceStatusReader(async () => draining, s => published.push(s))
  reader.start()
  await settle()
  assert.equal(published.at(-1)?.status?.state, "draining")
  assert.equal(published.at(-1)?.unavailable, false)
})

test("a failed or invalid read keeps the last status and marks it unavailable", async () => {
  let next: () => Promise<unknown> = async () => draining
  const reader = new MaintenanceStatusReader(() => next(), () => {})
  reader.start()
  await settle()
  next = async () => { throw new Error("offline") }
  await reader.refresh()
  assert.equal(reader.current().status?.state, "draining")
  assert.equal(reader.current().unavailable, true)
  next = async () => ({ state: "nonsense" })
  await reader.refresh()
  assert.equal(reader.current().status?.state, "draining")
  assert.equal(reader.current().unavailable, true)
  next = async () => idle
  await reader.refresh()
  assert.deepEqual(reader.current(), { status: { ...idle, state: "idle" }, unavailable: false })
})

test("a disconnect drops the read in flight and marks the status unavailable", async () => {
  const pending = deferred<unknown>()
  const reader = new MaintenanceStatusReader(() => pending.promise, () => {})
  reader.start()
  reader.disconnected()
  pending.resolve(idle)
  await settle()
  assert.deepEqual(reader.current(), { status: null, unavailable: true })
})

test("a burst collapses to one trailing read, and nothing publishes after stop", async () => {
  let reads = 0
  const gates: ReturnType<typeof deferred<unknown>>[] = []
  const published: MaintenanceStatusSnapshot[] = []
  const reader = new MaintenanceStatusReader(() => { reads++; const gate = deferred<unknown>(); gates.push(gate); return gate.promise }, s => published.push(s))
  reader.start()
  reader.refresh()
  reader.refresh()
  await settle()
  assert.equal(reads, 1)
  gates[0]!.resolve(draining)
  await settle()
  assert.equal(reads, 2)
  // The first answer is older than the trailing read: dropped.
  assert.equal(published.length, 0)
  reader.stop()
  gates[1]!.resolve(idle)
  await settle()
  assert.equal(published.length, 0)
})
