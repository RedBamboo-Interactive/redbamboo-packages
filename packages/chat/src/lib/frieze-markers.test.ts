import { test } from "node:test"
import assert from "node:assert/strict"
import type { MessageBlock, MessagePart } from "../types.ts"
import { projectActivityTimeline } from "./activity-timeline.ts"
import { filterFriezeParts, friezeMarkerKey, friezeMarkerNeedsAttention, type FriezeMarkerVisibility } from "./frieze-markers.ts"
import { squareSequence, stepSquare } from "./part-navigation.ts"

let seq = 0
const block = (role: MessageBlock["role"], parts: MessagePart[], metadata?: MessageBlock["metadata"]): MessageBlock => ({
  id: `m${seq++}`,
  role,
  parts,
  timestamp: `2026-11-15T12:00:${String(seq).padStart(2, "0")}Z`,
  ...(metadata ? { metadata } : {}),
})
const event = (key: string, content = key): MessagePart => ({ type: "tool_use", toolName: `event:${key}`, content })
const tool = (toolName: string, toolUseId?: string, content = toolName): MessagePart => ({ type: "tool_use", toolName, content, ...(toolUseId ? { toolUseId } : {}) })
const result = (content: string, toolUseId?: string): MessagePart => ({ type: "tool_result", content, ...(toolUseId ? { toolUseId } : {}) })
const text = (content: string): MessagePart => ({ type: "text", content })

const hiding = (...keys: string[]): FriezeMarkerVisibility => part => !keys.includes(friezeMarkerKey(part) ?? "")
const shape = (rows: ReturnType<typeof projectActivityTimeline>) => rows.map(row =>
  `${row.kind === "activity" ? "A" : row.block.role === "user" ? "U" : "N"}(${row.block.parts.map(p => p.content).join("+")})`).join(" ")

test("classifies every marker kind into a stable key", () => {
  assert.equal(friezeMarkerKey(event("callback")), "event:callback")
  assert.equal(friezeMarkerKey(event("delegate:abc123")), "event:delegate")
  assert.equal(friezeMarkerKey(tool("Read")), "tool:read-only")
  assert.equal(friezeMarkerKey(tool("Edit")), "tool:mutating")
  assert.equal(friezeMarkerKey(tool("Bash")), "tool:shell")
  assert.equal(friezeMarkerKey(tool("Agent")), "tool:agent")
  assert.equal(friezeMarkerKey(tool("SomethingNew")), "tool:other")
  assert.equal(friezeMarkerKey({ type: "thinking", content: "" }), "thinking")
  assert.equal(friezeMarkerKey({ type: "error", content: "" }), "error")
  assert.equal(friezeMarkerKey(result("ok")), null)
  assert.equal(friezeMarkerKey(text("hi")), null)
})

test("markers that need attention are recognised", () => {
  assert.equal(friezeMarkerNeedsAttention(event("callback")), false)
  assert.equal(friezeMarkerNeedsAttention(event("callback"), { queued: true }), true)
  assert.equal(friezeMarkerNeedsAttention(tool("Read"), { approval: true }), true)
  assert.equal(friezeMarkerNeedsAttention({ ...tool("Read"), isPartial: true }), true)
  assert.equal(friezeMarkerNeedsAttention({ ...tool("Agent"), task: { status: "running" } } as MessagePart), true)
  assert.equal(friezeMarkerNeedsAttention({ ...tool("Agent"), task: { status: "failed" } } as MessagePart), true)
  assert.equal(friezeMarkerNeedsAttention({ ...tool("Agent"), task: { status: "completed" } } as MessagePart), false)
  assert.equal(friezeMarkerNeedsAttention(tool("AskUserQuestion")), true)
  assert.equal(friezeMarkerNeedsAttention({ type: "error", content: "" }), true)
})

test("a hidden call takes its result with it, by id or by position", () => {
  const parts = [tool("Read", "r1"), tool("Bash", "b1"), result("read-out", "r1"), result("bash-out", "b1"), tool("Bash"), result("anon-out")]
  const visible = filterFriezeParts(parts, hiding("tool:shell"))
  assert.deepEqual(visible.parts.map(p => p.content), ["Read", "read-out"])
  assert.deepEqual(visible.kept, [0, 2])
})

test("a positional result never re-pairs with the visible call before a hidden one", () => {
  const parts = [tool("Read"), result("read-out"), tool("Bash"), result("bash-out")]
  assert.deepEqual(filterFriezeParts(parts, hiding("tool:shell")).parts.map(p => p.content), ["Read", "read-out"])
})

test("without a predicate the projection is unchanged", () => {
  const blocks = [block("assistant", [event("callback")]), block("assistant", [text("hello")])]
  assert.equal(shape(projectActivityTimeline(blocks)), "A(callback) N(hello)")
  assert.equal(shape(projectActivityTimeline(blocks, 0, undefined, () => true)), "A(callback) N(hello)")
})

test("an event-only row whose markers are all hidden renders no row", () => {
  const blocks = [
    block("assistant", [text("before")]),
    block("assistant", [event("callback"), event("discussion")]),
    block("assistant", [event("discussion")]),
    block("assistant", [text("after")]),
  ]
  const rows = projectActivityTimeline(blocks, 0, undefined, hiding("event:callback", "event:discussion"))
  assert.equal(shape(rows), "N(before) N(after)")
  assert.equal(rows[0].compactAfter, false)
})

test("hidden markers leave the row; the rest keep order and the row keeps its key", () => {
  const blocks = [block("assistant", [event("callback"), event("presence"), event("discussion"), event("mail")])]
  const shown = projectActivityTimeline(blocks)
  const filtered = projectActivityTimeline(blocks, 0, undefined, hiding("event:callback", "event:discussion"))
  assert.equal(shape(filtered), "A(presence+mail)")
  assert.equal(filtered[0].key, shown[0].key)
})

test("a split message whose activity is all hidden keeps compact segments", () => {
  const rows = projectActivityTimeline([block("assistant", [text("one"), tool("Read", "r"), result("x", "r"), text("two")])], 0, undefined, hiding("tool:read-only"))
  assert.equal(shape(rows), "N(one) N(two)")
  assert.equal(rows[0].compactAfter, true)
})

test("a row of orphan results is not drawn once its calls are hidden", () => {
  const blocks = [block("assistant", [tool("Bash", "b")]), block("assistant", [result("out", "b")]), block("assistant", [text("done")])]
  assert.equal(shape(projectActivityTimeline(blocks, 0, undefined, hiding("tool:shell"))), "N(done)")
})

test("an attention marker survives the host predicate through the panel's rule", () => {
  // ChatPanel composes: host says hidden, attention says shown.
  const failed = { ...event("callback"), messageUid: "q1" }
  const isShown: FriezeMarkerVisibility = part => hiding("event:callback")(part)
    || friezeMarkerNeedsAttention(part, { queued: part.messageUid === "q1" })
  const rows = projectActivityTimeline([block("assistant", [event("callback", "old"), failed])], 0, undefined, isShown)
  assert.equal(shape(rows), "A(callback)")
  assert.equal(rows[0].block.parts[0], failed)
})

test("a turn origin keeps its place and keeps the row when every square is hidden", () => {
  const origin = { kind: "background-task", taskId: "t1" }
  const woken = block("assistant", [event("callback"), tool("Read", "r"), result("x", "r")], { messageUid: "wake", turnOrigin: origin })
  const rows = projectActivityTimeline([block("assistant", [event("presence")]), woken], 0, undefined, hiding("event:callback"))
  assert.equal(shape(rows), "A(presence+Read+x)")
  assert.deepEqual(rows[0].turnOrigins, [{ before: 1, origin, turnKey: "wake" }])

  const allHidden = projectActivityTimeline([woken], 0, undefined, hiding("event:callback", "tool:read-only"))
  assert.equal(allHidden.length, 1)
  assert.deepEqual(allHidden[0].block.parts, [])
  assert.deepEqual(allHidden[0].turnOrigins, [{ before: 0, origin, turnKey: "wake" }])
})

test("stepping walks only the markers that are drawn", () => {
  const blocks = [
    block("assistant", [event("callback", "c1"), tool("Read", "r1", "read1"), result("x", "r1"), event("discussion", "d1")]),
    block("assistant", [text("between")]),
    block("assistant", [event("callback", "c2")]),
    block("assistant", [text("middle")]),
    block("assistant", [{ type: "thinking", content: "think" }, event("callback", "c3")]),
  ]
  const rows = projectActivityTimeline(blocks, 0, undefined, hiding("event:callback", "event:discussion"))
    .filter(row => row.kind === "activity")
    .map(row => ({ id: row.block.id, parts: row.block.parts }))
  const drawn = squareSequence(rows).map(ref => rows.find(row => row.id === ref.rowId)!.parts[ref.index]!.content)
  assert.deepEqual(drawn, ["read1", "think"])
  const first = squareSequence(rows)[0]!
  const next = stepSquare(rows, first, 1)!
  assert.equal(rows.find(row => row.id === next.rowId)!.parts[next.index]!.content, "think")
  assert.equal(stepSquare(rows, next, 1), undefined)
})
