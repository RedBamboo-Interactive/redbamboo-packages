import { test } from "node:test"
import assert from "node:assert/strict"
import type { MessageBlock, MessagePart } from "../types.ts"
import { projectActivityTimeline } from "./activity-timeline.ts"

let seq = 0
const part = (type: MessagePart["type"], content: string): MessagePart => ({ type, content })
const block = (role: MessageBlock["role"], parts: MessagePart[]): MessageBlock => ({
  id: `m${seq++}`,
  role,
  parts,
  timestamp: `2026-08-04T12:00:${String(seq).padStart(2, "0")}Z`,
})

const shape = (blocks: MessageBlock[]) => projectActivityTimeline(blocks).map(row =>
  row.kind === "activity"
    ? `A(${row.block.parts.map(p => p.content).join("+")})`
    : `${row.block.role === "user" ? "U" : "N"}(${row.block.parts.map(p => p.content).join("+")})`,
).join(" ")

test("events and tool activity share one row across message boundaries", () => {
  assert.equal(shape([
    block("assistant", [part("tool_use", "camera"), part("tool_use", "automation")]),
    block("assistant", [part("thinking", "silent turn")]),
    block("assistant", [part("tool_use", "weather")]),
  ]), "A(camera+automation+silent turn+weather)")
})

test("activity keeps chronological order across an ambient event boundary", () => {
  const event = part("tool_use", "weather")
  event.toolName = "event:weather"
  assert.equal(shape([
    block("assistant", [part("tool_use", "before")]),
    block("assistant", [event]),
    block("assistant", [part("tool_use", "after")]),
  ]), "A(before+weather+after)")
})

test("visible conversation content flushes the activity row", () => {
  assert.equal(shape([
    block("assistant", [part("tool_use", "before")]),
    block("assistant", [part("text", "said aloud")]),
    block("assistant", [part("tool_use", "after")]),
    block("user", [part("text", "question")]),
  ]), "A(before) N(said aloud) A(after) U(question)")
})

test("leading and trailing tools join activity on their side of visible text", () => {
  assert.equal(shape([
    block("assistant", [part("tool_use", "event-1")]),
    block("assistant", [part("thinking", "lead"), part("text", "answer"), part("tool_use", "trail")]),
    block("assistant", [part("tool_use", "event-2")]),
  ]), "A(event-1+lead) N(answer) A(trail+event-2)")
})

test("empty assistant text creates neither a row nor a boundary", () => {
  assert.equal(shape([
    block("assistant", [part("tool_use", "before")]),
    block("assistant", [part("text", "   ")]),
    block("assistant", [part("tool_use", "after")]),
  ]), "A(before+after)")
})

test("tool results stay beside their calls for modal pairing", () => {
  const rows = projectActivityTimeline([
    block("assistant", [part("tool_use", "call"), part("tool_result", "result")]),
    block("assistant", [part("tool_use", "event")]),
  ])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0].block.parts.map(p => p.type), ["tool_use", "tool_result", "tool_use"])
})

test("projection never mutates canonical blocks", () => {
  const canonical = [block("assistant", [part("thinking", "think"), part("text", "answer")])]
  const snapshot = structuredClone(canonical)
  projectActivityTimeline(canonical)
  assert.deepEqual(canonical, snapshot)
})

test("inserting an earlier row preserves every existing message key", () => {
  const existing = [
    block("user", [part("text", "first")]),
    block("assistant", [part("text", "answer")]),
    block("user", [part("text", "second")]),
  ]
  const before = projectActivityTimeline(existing).map(row => row.key)
  const inserted = block("user", [part("text", "inserted earlier")])
  const after = projectActivityTimeline([inserted, ...existing]).map(row => row.key)

  assert.deepEqual(after.slice(1), before)
})

test("extending an activity run preserves its mounted row identity", () => {
  const first = block("assistant", [part("tool_use", "first")])
  const before = projectActivityTimeline([first])[0].key
  const continuation = block("assistant", [part("thinking", "continuation")])
  const after = projectActivityTimeline([first, continuation])[0].key

  assert.equal(after, before)
})

test("working commentary stays visible until a final answer exists", () => {
  const commentary = part("text", "I am checking that now")
  commentary.phase = "commentary"
  assert.equal(shape([block("assistant", [commentary])]), "N(I am checking that now)")
})

test("a settled turn preserves its commentary before the final answer", () => {
  const commentary = part("text", "I found the issue and I am patching it")
  commentary.phase = "commentary"
  const answer = part("text", "Fixed. The issue was phase loss.")
  answer.phase = "final_answer"

  assert.equal(
    shape([block("assistant", [commentary, answer])]),
    "N(I found the issue and I am patching it+Fixed. The issue was phase loss.)",
  )
})

test("settled commentary remains visible across chronological segments of one turn", () => {
  const commentaryBlock = block("assistant", [
    { type: "text", content: "Still working", phase: "commentary" },
    part("tool_use", "compile"),
  ])
  commentaryBlock.metadata = { messageUid: "turn-1" }
  const finalBlock = block("assistant", [{ type: "text", content: "Done", phase: "final_answer" }])
  finalBlock.metadata = { messageUid: "turn-1" }

  assert.equal(shape([commentaryBlock, finalBlock]), "N(Still working) A(compile) N(Done)")
})

test("legacy unphased text remains visible beside a final answer", () => {
  const legacy = part("text", "legacy text")
  const answer = part("text", "final text")
  answer.phase = "final_answer"
  assert.equal(shape([block("assistant", [legacy, answer])]), "N(legacy text+final text)")
})
