import { test } from "node:test"
import assert from "node:assert/strict"
import { queuedMessageStatusLabel, maintenanceBlocksQueuedMessage } from "./queue-status.ts"
import { acknowledgeRemoteMessage } from "./message-queue.ts"
import type { QueuedMessage } from "./message-queue.ts"

const pending: QueuedMessage = { id: "client-a", text: "hello", remoteState: "pending", blockedReason: "maintenance_drain", appearance: "queue" }
test("maintenance wins over after-current wording and cannot promise interruption", () => {
  assert.equal(queuedMessageStatusLabel(pending), "Saved, waiting for the update to finish")
  assert.equal(queuedMessageStatusLabel({ ...pending, delivery: "interrupt-current" }), queuedMessageStatusLabel(pending))
  assert.equal(queuedMessageStatusLabel(pending, true), queuedMessageStatusLabel(pending))
  assert.equal(maintenanceBlocksQueuedMessage(pending), true)
})
test("local refusal and uncertain admission never claim the server saved input", () => {
  const failed = { ...pending, deliveryError: "Not sent: update pending", admissionUncertain: false }
  assert.equal(queuedMessageStatusLabel(failed), failed.deliveryError)
  assert.equal(maintenanceBlocksQueuedMessage(failed), false)
  assert.equal(maintenanceBlocksQueuedMessage({ ...pending, admissionUncertain: true }), false)
})
test("normal active waits and delivery retain their own meanings", () => {
  assert.match(queuedMessageStatusLabel({ ...pending, blockedReason: "active_turn" }), /after this turn/)
  assert.equal(queuedMessageStatusLabel({ ...pending, remoteState: "delivering" }), "Delivering message")
  assert.equal(maintenanceBlocksQueuedMessage({ ...pending, remoteState: "delivered" }), false)
})
test("delivered input cannot reacquire a maintenance blocker from late admission", () => {
  const next = acknowledgeRemoteMessage({ ...pending, remoteState: "delivered" }, {
    disposition: "queued", queue: { state: "waiting_for_session", depth: 1, blockedReason: "maintenance_drain" },
  })
  assert.equal(next.remoteState, "delivered")
  assert.equal(next.appearance, "message")
  assert.equal(next.blockedReason, undefined)
  assert.equal(next.id, pending.id)
})
