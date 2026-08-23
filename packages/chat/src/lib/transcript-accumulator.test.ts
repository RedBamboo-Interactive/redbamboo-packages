import assert from "node:assert/strict"
import test from "node:test"
import type { ChatEvent, MessageBlock, MessagePart } from "../types.ts"
import { TranscriptAccumulator } from "./transcript-accumulator.ts"

function assistant(parts: MessagePart[]): MessageBlock {
  return {
    id: "turn-1",
    role: "assistant",
    parts,
    timestamp: "2026-08-23T09:00:00Z",
    metadata: { messageUid: "turn-1" },
  }
}

function tool(sequence: number): ChatEvent {
  return {
    type: "tool_use",
    toolName: `tool-${sequence}`,
    messageId: `call-${sequence}`,
    messageUid: "turn-1",
    epoch: "epoch-1",
    sequence,
  }
}

test("keeps the exact 110-part history prefix and three uncovered live events", () => {
  const prefix = Array.from({ length: 110 }, (_, index): MessagePart => ({
    type: "tool_use",
    content: "",
    toolName: `tool-${index + 1}`,
    toolInput: "{}",
  }))
  const accumulator = new TranscriptAccumulator()
  accumulator.receiveLive(tool(111))
  accumulator.receiveLive(tool(112))
  accumulator.receiveLive(tool(113))
  accumulator.startSnapshot(1)

  const result = accumulator.commitSnapshot(1, [assistant(prefix)], {
    epoch: "epoch-1",
    throughSequence: 110,
  })

  assert.equal(result.messages[0].parts.length, 113)
  assert.equal(result.messages[0].parts[0].toolName, "tool-1")
  assert.equal(result.messages[0].parts[112].toolName, "tool-113")
})

test("does not replay live events covered by a later snapshot", () => {
  const accumulator = new TranscriptAccumulator()
  accumulator.receiveLive(tool(2))
  accumulator.startSnapshot("covered")
  const result = accumulator.commitSnapshot("covered", [assistant([{
    type: "tool_use", content: "", toolName: "durable", toolInput: "{}",
  }])], { epoch: "epoch-1", throughSequence: 3 })

  assert.equal(result.messages[0].parts.length, 1)
  assert.equal(result.messages[0].parts[0].toolName, "durable")
})

test("rejects a stale snapshot response", () => {
  const accumulator = new TranscriptAccumulator()
  accumulator.startSnapshot(1)
  accumulator.startSnapshot(2)
  const stale = accumulator.commitSnapshot(1, [assistant([])], {
    epoch: "epoch-1", throughSequence: 0,
  })
  assert.equal(stale.staleSnapshot, true)
  assert.deepEqual(stale.messages, [])
})

test("deduplicates repeated delivery by epoch and sequence", () => {
  const accumulator = new TranscriptAccumulator()
  accumulator.receiveLive(tool(1))
  accumulator.receiveLive(tool(1))
  assert.equal(accumulator.current()[0].parts.length, 1)
})

test("a new epoch resets the previous lineage", () => {
  const accumulator = new TranscriptAccumulator()
  accumulator.receiveLive(tool(1))
  const changed = accumulator.receiveLive({ ...tool(1), epoch: "epoch-2", toolName: "new-lineage" })
  assert.equal(accumulator.current()[0].parts.length, 1)
  assert.equal(accumulator.current()[0].parts[0].toolName, "new-lineage")
  assert.equal(changed.gapDetected, true)
})

test("reports a sequence gap without hiding visible content", () => {
  const accumulator = new TranscriptAccumulator()
  accumulator.startSnapshot("initial")
  accumulator.commitSnapshot("initial", [], { epoch: "epoch-1", throughSequence: 0 })
  const first = accumulator.receiveLive(tool(1))
  const gap = accumulator.receiveLive(tool(3))
  assert.equal(first.gapDetected, false)
  assert.equal(gap.gapDetected, true)
  assert.equal(gap.messages[0].parts.length, 2)
})
