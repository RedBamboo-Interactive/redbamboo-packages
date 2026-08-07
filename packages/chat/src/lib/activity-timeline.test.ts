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
