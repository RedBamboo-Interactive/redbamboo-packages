import assert from "node:assert/strict"
import { test } from "node:test"
import type { MessageBlock, MessagePart } from "../types"
import { findFocusBlockIndex, findFocusRow } from "./focus-message.ts"

const block = (id: string, extra: Partial<MessageBlock> = {}): MessageBlock => ({
  id, role: "user", parts: [], timestamp: "2026-10-27T10:00:00Z", ...extra,
})

test("a block matches by id or by one of its input message uids", () => {
  const blocks = [block("a"), block("b", { inputMessageUids: ["x", "y"] }), block("c")]
  assert.equal(findFocusBlockIndex(blocks, "c"), 2)
  assert.equal(findFocusBlockIndex(blocks, "y"), 1)
  assert.equal(findFocusBlockIndex(blocks, "missing"), -1)
})

test("an id match wins over an input uid match elsewhere", () => {
  const blocks = [block("a", { inputMessageUids: ["b"] }), block("b")]
  assert.equal(findFocusBlockIndex(blocks, "b"), 1)
})

const event = (messageUid: string): MessagePart =>
  ({ type: "tool_use", toolName: "event:agent-note", content: "", messageUid })
const eventBlock = (id: string, ...uids: string[]) =>
  block(id, { role: "assistant", parts: uids.map(event) })

test("a note is found by its own uid, though its block has another id", () => {
  // The real shape: seq 16831, a block `event-<uid>` whose part carries the uid.
  const uid = "d32629d3d410467193ec9bfa9e0f76cf"
  const blocks = [block("a"), eventBlock(`event-${uid}`, uid), block("c")]
  assert.equal(findFocusBlockIndex(blocks, uid), 1)
})

test("each member of a merged event block is found", () => {
  const blocks = [block("a"), eventBlock("event-n1", "n1", "n2", "n3")]
  assert.equal(findFocusBlockIndex(blocks, "n3"), 1)
})

test("an id or input uid match wins over an event holding that uid", () => {
  const blocks = [eventBlock("event-x", "x"), block("b", { inputMessageUids: ["x"] }), block("x")]
  assert.equal(findFocusBlockIndex(blocks, "x"), 2)
  assert.equal(findFocusBlockIndex(blocks.slice(0, 2), "x"), 1)
})

test("a part that isn't an event doesn't answer for its uid", () => {
  const text: MessagePart = { type: "text", content: "hi", messageUid: "t1" }
  assert.equal(findFocusBlockIndex([block("a", { role: "assistant", parts: [text] })], "t1"), -1)
})

test("adjacent notes in one block centre their own row, not the block's first", () => {
  const row = (id: string, ...uids: string[]) => ({ sourceIndices: [1], block: eventBlock(id, ...uids) })
  const rows = [
    { sourceIndices: [0], block: block("a") },
    row("event-row:n1", "n1"),
    row("event-row:n2", "n2"),
  ]
  assert.equal(findFocusRow(rows, 1, "n2")?.block.id, "event-row:n2")
  assert.equal(findFocusRow(rows, 1, "n1")?.block.id, "event-row:n1")
})

test("a dot centres the frieze row that holds it, and any other uid keeps the block's first row", () => {
  const frieze = { sourceIndices: [2, 3], block: eventBlock("activity", "dot") }
  const after = { sourceIndices: [3], block: block("text") }
  assert.equal(findFocusRow([frieze, after], 3, "dot"), frieze)
  assert.equal(findFocusRow([frieze, after], 3, "plain-uid"), frieze)
  assert.equal(findFocusRow([frieze, after], 3, null), frieze)
  assert.equal(findFocusRow([frieze], 9, "dot"), undefined)
})
