import assert from "node:assert/strict"
import test from "node:test"
import { normalizePushToTalkKey } from "./push-to-talk-key.ts"

test("normalizes supported push-to-talk keys", () => {
  assert.equal(normalizePushToTalkKey("f13"), "F13")
  assert.equal(normalizePushToTalkKey("A"), "a")
  assert.equal(normalizePushToTalkKey("7"), "7")
  assert.equal(normalizePushToTalkKey("ArrowDown"), "ArrowDown")
})

test("rejects modifiers and keys that require a chord", () => {
  assert.equal(normalizePushToTalkKey("Shift"), null)
  assert.equal(normalizePushToTalkKey("?"), null)
  assert.equal(normalizePushToTalkKey("F25"), null)
})
