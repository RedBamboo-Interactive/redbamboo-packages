import { test } from "node:test"
import assert from "node:assert/strict"
import { rebuildBlocks } from "./rebuild-blocks.ts"

test("history restores attachment metadata from the provider-neutral envelope", () => {
  const attachmentsJson = JSON.stringify({ attachments: [{
    id: "att_123", kind: "file", name: "proposal.pdf", mediaType: "application/pdf",
    size: 42, sha256: "abc", downloadUrl: "/ai-session/input-attachments/att_123",
  }] })
  const blocks = rebuildBlocks([{ id: 1, role: "user", eventType: "text", content: "Review", timestamp: "2026-08-01T00:00:00Z", attachmentsJson }])
  assert.equal(blocks[0]?.parts[0]?.attachments?.[0]?.id, "att_123")
  assert.equal(blocks[0]?.parts[0]?.attachments?.[0]?.name, "proposal.pdf")
})

test("legacy image envelopes remain compatible", () => {
  const image = { mediaType: "image/png", base64: "cG5n" }
  const blocks = rebuildBlocks([{ id: 1, role: "user", eventType: "text", timestamp: "2026-08-01T00:00:00Z", attachmentsJson: JSON.stringify({ images: [image] }) }])
  assert.deepEqual(blocks[0]?.parts[0]?.images, [image])
})

test("record timestamps, not persistence order, define transcript chronology", () => {
  const blocks = rebuildBlocks([
    { id: 2, role: "assistant", eventType: "tool_result", toolResult: "done", timestamp: "2026-08-01T00:00:02Z", messageUid: "turn" },
    { id: 1, role: "assistant", eventType: "tool_use", toolName: "Read", timestamp: "2026-08-01T00:00:01Z", messageUid: "turn" },
  ])
  assert.deepEqual(blocks[0]?.parts.map((part) => part.type), ["tool_use", "tool_result"])
})

test("an ambient user event splits one assistant turn into unique chronological segments", () => {
  const blocks = rebuildBlocks([
    { id: 1, role: "assistant", eventType: "tool_use", toolName: "Read", timestamp: "2026-08-01T00:00:01Z", messageUid: "turn" },
    { id: 2, role: "user", eventType: "text", content: '<nova-event source="weather">Rain</nova-event>', timestamp: "2026-08-01T00:00:02Z", messageUid: "event" },
    { id: 3, role: "assistant", eventType: "tool_use", toolName: "Write", timestamp: "2026-08-01T00:00:03Z", messageUid: "turn" },
  ])
  assert.deepEqual(blocks.map((block) => block.id), ["turn", "event", "turn:segment:1"])
})
