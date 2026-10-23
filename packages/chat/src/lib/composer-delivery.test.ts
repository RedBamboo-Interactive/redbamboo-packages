import assert from "node:assert/strict"
import test from "node:test"
import { composerDelivery, shouldSubmitDraftOnTab } from "./composer-delivery.ts"

test("busy Enter steers only for a capable provider", () => {
  assert.equal(composerDelivery({ isStreaming: true, supportsSteering: true }), "steer-current")
  assert.equal(composerDelivery({ isStreaming: true, supportsSteering: false }), "after-current")
  assert.equal(composerDelivery({ isStreaming: false, supportsSteering: true }), "after-current")
})

test("busy Tab queues while Ctrl submit remains a hard interrupt", () => {
  assert.equal(composerDelivery({ isStreaming: true, supportsSteering: true, queueAfterCurrent: true }), "after-current")
  assert.equal(composerDelivery({ isStreaming: true, supportsSteering: true, interruptToo: true }), "interrupt-current")
})

test("Tab captures any non-empty unmodified draft, busy or idle", () => {
  assert.equal(shouldSubmitDraftOnTab({ hasContent: true }), true)
  assert.equal(shouldSubmitDraftOnTab({ hasContent: false }), false)
  assert.equal(shouldSubmitDraftOnTab({ hasContent: true, shiftKey: true }), false)
  assert.equal(shouldSubmitDraftOnTab({ hasContent: true, ctrlKey: true }), false)
})

test("idle Tab sends like Enter", () => {
  assert.equal(composerDelivery({ isStreaming: false, supportsSteering: true, queueAfterCurrent: true }), "after-current")
})
