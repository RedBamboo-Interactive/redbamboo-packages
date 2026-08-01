import assert from "node:assert/strict"
import test from "node:test"
import type { TranscriptPayloadRef } from "../types.ts"
import { rebuildBlocks } from "./rebuild-blocks.ts"
import { fetchTranscriptPayload } from "./http-transcript-payload.ts"
import { processStreamEvent } from "./process-stream-event.ts"

const ref: TranscriptPayloadRef = {
  recordId: 42,
  kind: "tool-output",
  length: 12,
  contentType: "text/plain; charset=utf-8",
  encoding: "utf-8",
  sha256: "abc",
  available: true,
}

test("rebuildBlocks preserves a payload reference without inline output", () => {
  const blocks = rebuildBlocks([{
    id: 42,
    role: "assistant",
    eventType: "tool_result",
    content: null,
    toolResult: null,
    payloadRef: ref,
    timestamp: "2026-08-01T12:00:00Z",
  }])

  assert.equal(blocks.length, 1)
  assert.equal(blocks[0]!.parts[0]!.content, "")
  assert.deepEqual(blocks[0]!.parts[0]!.payloadRef, ref)
})

test("live tool-result events preserve the payload reference without inline bytes", () => {
  const result = processStreamEvent([], true, {
    type: "tool_result",
    content: null,
    toolResult: null,
    payloadRef: ref,
  })
  assert.equal(result.messages[0]!.parts[0]!.content, "")
  assert.deepEqual(result.messages[0]!.parts[0]!.payloadRef, ref)
})

test("fetchTranscriptPayload sends an exact byte range and parses Content-Range", async () => {
  const originalFetch = globalThis.fetch
  let sentRange: string | null = null
  globalThis.fetch = async (_input, init) => {
    sentRange = new Headers(init?.headers).get("range")
    return new Response(new Uint8Array([1, 2, 3, 4]), {
      status: 206,
      headers: { "Content-Range": "bytes 4-7/12" },
    })
  }

  try {
    const chunk = await fetchTranscriptPayload("/output", ref, { start: 4, end: 8 }, new AbortController().signal)
    assert.equal(sentRange, "bytes=4-7")
    assert.equal(chunk.start, 4)
    assert.equal(chunk.end, 8)
    assert.equal(chunk.total, 12)
    assert.deepEqual([...chunk.bytes], [1, 2, 3, 4])
  } finally {
    globalThis.fetch = originalFetch
  }
})
