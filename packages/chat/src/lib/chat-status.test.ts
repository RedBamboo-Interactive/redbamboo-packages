import assert from "node:assert/strict"
import test from "node:test"
import { getChatStatusPresentation, isContextCompactionActive } from "./chat-status.ts"
import type { MessageBlock } from "../types.ts"

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

test("active compaction replaces responding with a grey truthful phase", () => {
  assert.deepEqual(getChatStatusPresentation({
    isStreaming: true,
    isReconnecting: false,
    streamingColor: "#14b8a6",
    isCompacting: true,
  }), {
    color: "var(--color-text-disabled)",
    label: "Compacting context...",
  })
})

test("compaction state follows the unresolved activity square", () => {
  const messages: MessageBlock[] = [{
    id: "turn-1",
    role: "assistant",
    timestamp: "2026-10-04T10:33:07Z",
    parts: [{
      type: "tool_use",
      toolName: "ContextCompaction",
      content: "",
      isPartial: true,
    }],
  }]
  assert.equal(isContextCompactionActive(messages), true)
  messages[0]!.parts[0] = { ...messages[0]!.parts[0]!, isPartial: false }
  assert.equal(isContextCompactionActive(messages), true, "history reload has no live partial flag")
  messages[0]!.parts.push({ type: "tool_result", content: "Context compacted" })
  assert.equal(isContextCompactionActive(messages), false)
  messages.push({
    id: "user-2", role: "user", timestamp: "2026-10-04T10:36:00Z",
    parts: [{ type: "text", content: "next" }],
  })
  assert.equal(isContextCompactionActive(messages), false, "an older unpaired turn cannot leak forward")

  messages.push({
    id: "turn-2", role: "assistant", timestamp: "2026-10-04T10:36:01Z",
    parts: [
      { type: "tool_use", toolName: "ContextCompaction", content: "" },
      { type: "tool_use", toolName: "Read", content: "" },
    ],
  })
  assert.equal(isContextCompactionActive(messages), false, "a later activity closes an unpaired stale marker")
})
