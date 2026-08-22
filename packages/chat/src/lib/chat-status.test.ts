import assert from "node:assert/strict"
import test from "node:test"
import { getChatStatusPresentation } from "./chat-status.ts"

test("reconnecting replaces the streaming presentation", () => {
  assert.deepEqual(getChatStatusPresentation({
    isStreaming: true,
    isReconnecting: true,
    streamingColor: "#14b8a6",
  }), {
    color: "#ef4444",
    icon: "ph-bold ph-arrows-clockwise",
    label: "Reconnecting...",
  })
})

test("streaming keeps the responding presentation", () => {
  assert.deepEqual(getChatStatusPresentation({
    isStreaming: true,
    isReconnecting: false,
    streamingColor: "#14b8a6",
  }), {
    color: "#14b8a6",
    label: "Responding...",
  })
})

test("an idle connected chat has no activity status", () => {
  assert.equal(getChatStatusPresentation({
    isStreaming: false,
    isReconnecting: false,
    streamingColor: "#14b8a6",
  }), null)
})
