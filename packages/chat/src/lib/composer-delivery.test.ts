import assert from "node:assert/strict"
import test from "node:test"
import { composerDelivery, shouldQueueBusyDraftOnTab } from "./composer-delivery.ts"

test("busy Enter steers only for a capable provider", () => {
  assert.equal(composerDelivery({ isStreaming: true, supportsSteering: true }), "steer-current")
  assert.equal(composerDelivery({ isStreaming: true, supportsSteering: false }), "after-current")
  assert.equal(composerDelivery({ isStreaming: false, supportsSteering: true }), "after-current")
})

test("busy Tab queues while Ctrl submit remains a hard interrupt", () => {
  assert.equal(composerDelivery({ isStreaming: true, supportsSteering: true, queueAfterCurrent: true }), "after-current")
  assert.equal(composerDelivery({ isStreaming: true, supportsSteering: true, interruptToo: true }), "interrupt-current")
})

test("Tab only captures a non-empty unmodified draft while busy", () => {
  assert.equal(shouldQueueBusyDraftOnTab({ isStreaming: true, hasContent: true }), true)
  assert.equal(shouldQueueBusyDraftOnTab({ isStreaming: false, hasContent: true }), false)
  assert.equal(shouldQueueBusyDraftOnTab({ isStreaming: true, hasContent: false }), false)
  assert.equal(shouldQueueBusyDraftOnTab({ isStreaming: true, hasContent: true, shiftKey: true }), false)
})
