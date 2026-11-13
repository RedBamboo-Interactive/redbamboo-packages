import { test } from "node:test"
import assert from "node:assert/strict"
import { maintenanceNotice, parseMaintenanceStatus } from "./maintenance-status.ts"

const status = { state: "draining" as const, paused: true, runId: "run-a", startedAt: "2026-10-03T10:00:00Z", changedAt: "2026-10-03T10:00:00Z", activeTurnCount: 2 }

test("existing-session notice explains the global wait and server-saved input", () => {
  const notice = maintenanceNotice(status, true)!
  assert.match(notice.detail, /2 active conversations/)
  assert.match(notice.detail, /Accepted messages are saved/)
  assert.match(notice.detail, /automatically/)
})
test("sessionless notice never promises server admission or automatic delivery", () => {
  const notice = maintenanceNotice(status, false)!
  assert.match(notice.detail, /this device/)
  assert.match(notice.detail, /retry/)
  assert.doesNotMatch(notice.detail, /messages are saved|will send/)
})
test("unavailable status preserves a known pause without claiming completion", () => {
  assert.match(maintenanceNotice(status, true, true)!.detail, /last status/)
  assert.equal(maintenanceNotice(null, true, true), null)
})
test("launching, failed and idle states cannot be mistaken for a working agent", () => {
  assert.equal(maintenanceNotice({ ...status, state: "launching" }, true)!.title, "Restarting for an update")
  assert.match(maintenanceNotice({ ...status, state: "failed", paused: false }, true)!.detail, /delivery has resumed/)
  assert.equal(maintenanceNotice({ ...status, state: "idle", paused: false }, true), null)
})
test("malformed or contradictory status is unknown rather than idle", () => {
  assert.deepEqual(parseMaintenanceStatus(status), status)
  for (const value of [null, {}, { ...status, paused: false }, { ...status, activeTurnCount: -1 }, { ...status, changedAt: "invalid" }])
    assert.equal(parseMaintenanceStatus(value), null)
})
test("fields RedCompute omits when null parse as null", () => {
  // The live idle response: runId, startedAt and activeTurnCount are left out, not sent as null.
  const changedAt = "2026-11-13T00:12:09.8960519+00:00"
  assert.deepEqual(parseMaintenanceStatus({ state: "idle", paused: false, changedAt }),
    { state: "idle", paused: false, runId: null, startedAt: null, changedAt, activeTurnCount: null })
  const launching = parseMaintenanceStatus({ state: "launching", paused: true, runId: "run-a", startedAt: changedAt, changedAt })!
  assert.equal(launching.activeTurnCount, null)
  assert.equal(maintenanceNotice(launching, true)!.title, "Restarting for an update")
  assert.equal(parseMaintenanceStatus({ state: "draining", paused: true, changedAt, activeTurnCount: "2" }), null)
})
