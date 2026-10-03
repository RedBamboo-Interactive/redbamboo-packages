import assert from "node:assert/strict"
import test from "node:test"
import type { ChatEvent, MessageBlock } from "../types.ts"
import { processStreamEvent } from "./process-stream-event.ts"
import { rebuildBlocks } from "./rebuild-blocks.ts"
import { TranscriptAccumulator } from "./transcript-accumulator.ts"

function thinking(id: string, content = "", isPartial = true): ChatEvent {
  return { type: "thinking", messageId: id, messageUid: "turn", content, isPartial }
}
function replay(events: ChatEvent[], initial: MessageBlock[] = []) {
  return events.reduce((messages, event) => processStreamEvent(messages, true, event).messages, initial)
}
const parts = (messages: MessageBlock[]) => messages.flatMap(b => b.parts).filter(p => p.type === "thinking")

test("empty reasoning start creates one active square and completion-only text fills it", () => {
  const started = replay([thinking("r1")])
  assert.equal(parts(started).length, 1)
  assert.equal(parts(started)[0].isPartial, true)
  assert.equal(parts(started)[0].content, "")
  const settled = replay([thinking("r1", "Summary", false)], started)
  assert.equal(parts(settled).length, 1)
  assert.equal(parts(settled)[0].content, "Summary")
  assert.equal(parts(settled)[0].isPartial, false)
  assert.equal(started[0].parts[0].content, "", "updates leave previous snapshots immutable")
})

test("deltas, multiple summary parts and an empty completion keep one exact summary", () => {
  const messages = replay([thinking("r1"), thinking("r1", "First"), thinking("r1", "\n\n"), thinking("r1", "Second"), thinking("r1", "", false)])
  assert.equal(parts(messages).length, 1)
  assert.equal(parts(messages)[0].content, "First\n\nSecond")
  assert.equal(parts(messages)[0].thinkingState, "completed")
})

test("empty public reasoning settles and successive native ids stay distinct", () => {
  const messages = replay([thinking("r1"), thinking("r1", "", false), thinking("r2"), thinking("r2", "Second", false)])
  assert.deepEqual(parts(messages).map(p => [p.messageId, p.content, p.isPartial]), [["r1", "", false], ["r2", "Second", false]])
  const history = rebuildBlocks(["r1", "r2"].map((messageId, i) => ({ id: i + 1, role: "assistant", eventType: "thinking", messageId, messageUid: "turn", content: i ? "Second" : "", timestamp: "2026-10-03T10:00:00Z" })))
  assert.deepEqual(parts(history).map(p => [p.messageId, p.content]), [["r1", ""], ["r2", "Second"]])
})

test("summary updates preserve item identity around an ambient event", () => {
  const started = replay([thinking("r1")])
  const ambient: MessageBlock = { id: "ambient", role: "assistant", parts: [{ type: "tool_use", toolName: "event:weather", content: "Rain" }], timestamp: "2026-10-03T10:00:01Z" }
  const messages = replay([thinking("r1", "Summary"), thinking("r1", "", false)], [...started, ambient])
  assert.equal(parts(messages).length, 1)
  assert.equal(parts(messages)[0].content, "Summary")
  assert.equal(messages.at(-1)?.id, "ambient")
})

test("history overlap neither duplicates a completed summary nor loses an uncovered start", () => {
  const accumulator = new TranscriptAccumulator()
  accumulator.receiveLive({ ...thinking("r1"), epoch: "e", sequence: 1 })
  accumulator.startSnapshot(1)
  let result = accumulator.commitSnapshot(1, [], { epoch: "e", throughSequence: 0 })
  assert.equal(parts(result.messages)[0].isPartial, true)
  accumulator.receiveLive({ ...thinking("r1", "Summary"), epoch: "e", sequence: 2 })
  const history = rebuildBlocks([{ id: 1, role: "assistant", eventType: "thinking", content: "Summary", messageId: "r1", messageUid: "turn", timestamp: "2026-10-03T10:00:00Z" }])
  accumulator.startSnapshot(2)
  result = accumulator.commitSnapshot(2, history, { epoch: "e", throughSequence: 2 })
  result = accumulator.receiveLive({ ...thinking("r1", "", false), epoch: "e", sequence: 3 })
  assert.equal(parts(result.messages).length, 1)
  assert.equal(parts(result.messages)[0].content, "Summary")
  assert.equal(parts(result.messages)[0].isPartial, false)
  assert.equal(accumulator.receiveLive({ ...thinking("r1", "", false), epoch: "e", sequence: 3 }).messages[0].parts.length, 1)
})

test("legacy thought chunks retain their append behavior", () => {
  const messages = replay([{ type: "thinking", content: "One" }, { type: "thinking", content: " two" }])
  assert.equal(parts(messages).length, 1)
  assert.equal(parts(messages)[0].content, "One two")
})

test("OpenCode may reuse a native message id after a completed reasoning part", () => {
  const messages = replay([thinking("message", "First"), thinking("message", "", false), { type: "tool_use", toolName: "Read", messageUid: "turn" }, thinking("message", "Second"), thinking("message", "", false)])
  assert.deepEqual(parts(messages).map(p => p.content), ["First", "Second"])
})

test("interruption settles a placeholder and another turn cannot absorb it", () => {
  const interrupted = processStreamEvent(replay([thinking("r1")]), true, { type: "status", content: "interrupted" })
  assert.equal(parts(interrupted.messages)[0].isPartial, false)
  assert.equal(interrupted.isStreaming, false)
  const messages = replay([{ ...thinking("r1", "New"), messageUid: "other-turn" }], interrupted.messages)
  assert.equal(parts(messages).length, 2)
  assert.deepEqual(parts(messages).map(p => p.content), ["", "New"])
})
