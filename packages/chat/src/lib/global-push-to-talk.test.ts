import assert from "node:assert/strict"
import test from "node:test"
import { parseGlobalPushToTalkDetail } from "./global-push-to-talk.ts"

test("accepts a complete global push-to-talk signal", () => {
  assert.deepEqual(parseGlobalPushToTalkDetail({ key: "F13", pressed: true }), {
    key: "F13",
    pressed: true,
  })
})

test("rejects malformed global push-to-talk signals", () => {
  assert.equal(parseGlobalPushToTalkDetail(null), null)
  assert.equal(parseGlobalPushToTalkDetail({ key: "F13" }), null)
  assert.equal(parseGlobalPushToTalkDetail({ key: 124, pressed: false }), null)
})
