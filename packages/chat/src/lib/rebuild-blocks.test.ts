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

test("ordered records use transcript sequence instead of timestamp", () => {
  const blocks = rebuildBlocks([
    { id: 1, role: "assistant", eventType: "text", content: "second", timestamp: "2026-08-01T00:00:01Z", epoch: "e", sequence: 2 },
    { id: 2, role: "assistant", eventType: "text", content: "first", timestamp: "2026-08-01T00:00:02Z", epoch: "e", sequence: 1 },
  ])

  assert.equal(blocks[0].parts[0].content, "firstsecond")
})

// LIVE fe9ef992, 13 Nov 2026: a timed-out inline write RedLeaf had committed was re-queued without
// its idempotency key, so rows 32966552 and 32966571 both carry epoch/sequence 1387.
test("two stored rows of one (epoch, sequence) render once, the first stored", () => {
  const epoch = "6a7d3edbb34ba46017a965ffbca1a3b5"
  const uid = "7bccab843c4748c1aece1d9fadce7b37"
  const text = "It's 16:00, time for Tinder's gaba. \u{1F43E}"
  const final = { role: "assistant", eventType: "text", phase: "final_answer" as const, messageId: "msg_011Ch17yu7PQXCekAdQvTEPa:1", messageUid: uid, epoch, timestamp: "2026-11-13T14:56:01.1481357Z" }
  const blocks = rebuildBlocks([
    { id: 32966539, role: "assistant", eventType: "thinking", content: "Check the Miamor point.", messageId: "msg_011Ch17yu7PQXCekAdQvTEPa:0", messageUid: uid, epoch, sequence: 1359, timestamp: "2026-11-13T14:56:00.0663631Z" },
    { id: 32966552, ...final, content: text, sequence: 1387 },
    { id: 32966559, role: "assistant", eventType: "status", content: "idle", epoch, sequence: 1389, timestamp: "2026-11-13T14:56:16.1996396Z" },
    { id: 32966571, ...final, content: text, sequence: 1387 },
  ])

  assert.equal(blocks.length, 1)
  assert.deepEqual(blocks[0].parts.filter(p => p.type === "text").map(p => p.content), [text])
})

test("identical text at distinct sequences or epochs is not a duplicate", () => {
  const blocks = rebuildBlocks([
    { id: 1, role: "assistant", eventType: "text", content: "ha", messageUid: "t", timestamp: "2026-08-01T00:00:01Z", epoch: "e", sequence: 1 },
    { id: 2, role: "assistant", eventType: "text", content: "ha", messageUid: "t", timestamp: "2026-08-01T00:00:02Z", epoch: "e", sequence: 2 },
    { id: 3, role: "assistant", eventType: "text", content: "ho", messageUid: "u", timestamp: "2026-08-01T00:00:03Z", epoch: "f", sequence: 2 },
  ])

  assert.deepEqual(blocks.map(b => b.parts.map(p => p.content).join("")), ["haha", "ho"])
})

test("history preserves message phases and does not merge commentary into the final answer", () => {
  const blocks = rebuildBlocks([
    { id: 1, role: "assistant", eventType: "text", content: "Working", phase: "commentary", timestamp: "2026-08-01T00:00:01Z", messageUid: "turn" },
    { id: 2, role: "assistant", eventType: "text", content: "Done", phase: "final_answer", timestamp: "2026-08-01T00:00:02Z", messageUid: "turn" },
  ])

  assert.deepEqual(blocks[0]?.parts.map(({ content, phase }) => ({ content, phase })), [
    { content: "Working", phase: "commentary" },
    { content: "Done", phase: "final_answer" },
  ])
})

test("batch identities survive reconstruction beside images, files and captured context", () => {
  const blocks = rebuildBlocks([{
    id: 7, role: "user", eventType: "text", messageUid: "first", epoch: "e", sequence: 12,
    content: '<nova-context input="typed">context</nova-context>one\ntwo', timestamp: "2026-09-12T22:00:00Z",
    attachmentsJson: JSON.stringify({ inputMessageUids: ["first", "second"],
      attachments: [{ id: "att_file", kind: "file", name: "notes.txt" }],
      images: [{ mediaType: "image/png", base64: "cG5n" }] }),
  }])
  assert.deepEqual(blocks[0].inputMessageUids, ["first", "second"])
  assert.equal(blocks[0].metadata?.input, "typed")
  assert.equal(blocks[0].parts[0].attachments?.[0].id, "att_file")
  assert.equal(blocks[0].parts[0].images?.[0].base64, "cG5n")
})
test("malformed batch metadata cannot invent input identities", () => {
  for (const inputMessageUids of [null, "first", [null, 4, "", "second"]]) {
    const blocks = rebuildBlocks([{ id: 1, role: "user", eventType: "text", messageUid: "first",
      timestamp: "2026-09-12T22:00:00Z", attachmentsJson: JSON.stringify({ inputMessageUids }) }])
    assert.deepEqual(blocks[0].inputMessageUids, Array.isArray(inputMessageUids) ? ["second"] : undefined)
  }
})
