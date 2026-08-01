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
