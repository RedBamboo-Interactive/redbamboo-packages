import assert from "node:assert/strict"
import test from "node:test"
import type { ChatEvent, MessageBlock, MessagePart } from "../types.ts"
import { TranscriptAccumulator } from "./transcript-accumulator.ts"
import { rebuildBlocks, type PersistedMessage } from "./rebuild-blocks.ts"

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

const spikeSequences: Array<{ name: string; records: PersistedMessage[]; steerSequence: number }> = [
  {
    name: "Claude replay-user-messages: tool result, replayed steer, same-turn final",
    steerSequence: 3,
    records: [
      { id: 1, role: "assistant", eventType: "tool_use", toolName: "Bash", content: "", messageUid: "claude-turn", epoch: "claude", sequence: 1, timestamp: "2026-10-21T13:26:31.000Z" },
      { id: 2, role: "assistant", eventType: "tool_result", toolResult: "FIRST_TOOL_DONE", messageUid: "claude-turn", epoch: "claude", sequence: 2, timestamp: "2026-10-21T13:26:54.552Z" },
      { id: 3, role: "user", eventType: "text", content: "STEER_MARKER_723379ff", messageUid: "claude-steer", epoch: "claude", sequence: 3, timestamp: "2026-10-21T13:26:54.786Z" },
      { id: 4, role: "assistant", eventType: "text", content: "TURQUOISE", messageUid: "claude-turn", epoch: "claude", sequence: 4, timestamp: "2026-10-21T13:26:56.410Z" },
    ],
  },
  {
    name: "Codex turn/steer: userMessage before command completion, same-turn final",
    steerSequence: 2,
    records: [
      { id: 1, role: "assistant", eventType: "tool_use", toolName: "commandExecution", content: "", messageUid: "codex-turn", epoch: "codex", sequence: 1, timestamp: "2026-10-21T13:26:02.000Z" },
      { id: 2, role: "user", eventType: "text", content: "STEER_MARKER_723379ff", messageUid: "codex-steer", epoch: "codex", sequence: 2, timestamp: "2026-10-21T13:26:02.295Z" },
      { id: 3, role: "assistant", eventType: "tool_result", toolResult: "Passed", messageUid: "codex-turn", epoch: "codex", sequence: 3, timestamp: "2026-10-21T13:26:08.000Z" },
      { id: 4, role: "assistant", eventType: "text", content: "TURQUOISE", messageUid: "codex-turn", epoch: "codex", sequence: 4, timestamp: "2026-10-21T13:26:09.000Z" },
    ],
  },
]

for (const spike of spikeSequences) test(`${spike.name} replays identically live and from history`, () => {
  const prefix = spike.records.filter(record => record.sequence! <= spike.steerSequence)
  const suffix = spike.records.filter(record => record.sequence! > spike.steerSequence)
  const accumulator = new TranscriptAccumulator()
  for (const record of suffix) accumulator.receiveLive({
    type: record.eventType as ChatEvent["type"],
    content: record.content ?? record.toolResult,
    toolName: record.toolName,
    messageUid: record.messageUid,
    epoch: record.epoch,
    sequence: record.sequence,
    timestamp: record.timestamp,
  })
  accumulator.receiveLive({
    type: "status", content: "completed", messageUid: suffix.at(-1)!.messageUid,
    epoch: suffix.at(-1)!.epoch, sequence: suffix.at(-1)!.sequence! + 1,
  })
  accumulator.startSnapshot(spike.name)
  const live = accumulator.commitSnapshot(spike.name, rebuildBlocks(prefix), {
    epoch: prefix.at(-1)!.epoch!, throughSequence: spike.steerSequence,
  }).messages
  const history = rebuildBlocks(spike.records)

  const shape = (blocks: MessageBlock[]) => blocks.map(block => ({
    id: block.id, role: block.role,
    parts: block.parts.map(part => ({ type: part.type, content: part.content, toolName: part.toolName })),
  }))
  assert.deepEqual(shape(live), shape(history))
  assert.deepEqual(live.map(block => block.role), ["assistant", "user", "assistant"])
  assert.equal(live.filter(block => block.id === `${spike.records[0].messageUid}:segment:1`).length, 1)
})
