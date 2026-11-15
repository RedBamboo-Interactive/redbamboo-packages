import test from "node:test"
import assert from "node:assert/strict"
import type { MessagePart } from "../types.ts"
import { isInspectablePart, isVisibleErrorPart, squareSequence, stepSquare, type SquareRow } from "./part-navigation.ts"

const part = (type: MessagePart["type"], toolName?: string): MessagePart => ({ type, content: "", toolName })

// Two activity rows split by commentary, as projectActivityTimeline renders them.
const rows: SquareRow[] = [
  { id: "activity:a", parts: [part("thinking"), part("tool_use", "Read"), part("tool_result"), part("tool_use", "Grep"), part("tool_result")] },
  { id: "activity:b", parts: [part("tool_use", "Edit"), part("tool_result"), part("image"), part("tool_use", "event:weather")] },
]

test("squares are every non-inline part except results, in timeline order", () => {
  assert.deepEqual(squareSequence(rows), [
    { rowId: "activity:a", index: 0 },
    { rowId: "activity:a", index: 1 },
    { rowId: "activity:a", index: 3 },
    { rowId: "activity:b", index: 0 },
    { rowId: "activity:b", index: 3 },
  ])
})

test("stepping skips paired results and crosses into the next row", () => {
  assert.deepEqual(stepSquare(rows, { rowId: "activity:a", index: 1 }, 1), { rowId: "activity:a", index: 3 })
  assert.deepEqual(stepSquare(rows, { rowId: "activity:a", index: 3 }, 1), { rowId: "activity:b", index: 0 })
  assert.deepEqual(stepSquare(rows, { rowId: "activity:b", index: 0 }, -1), { rowId: "activity:a", index: 3 })
})

test("navigation stops at both ends instead of wrapping", () => {
  assert.equal(stepSquare(rows, { rowId: "activity:a", index: 0 }, -1), undefined)
  assert.equal(stepSquare(rows, { rowId: "activity:b", index: 3 }, 1), undefined)
})

test("a position that is not a square has no neighbours", () => {
  assert.equal(stepSquare(rows, { rowId: "activity:a", index: 2 }, 1), undefined)
  assert.equal(stepSquare(rows, { rowId: "activity:missing", index: 0 }, -1), undefined)
})

test("a live row that appends a square extends the sequence", () => {
  const live: SquareRow[] = [rows[0], { ...rows[1], parts: [...rows[1].parts, part("tool_use", "Bash")] }]
  assert.equal(stepSquare(rows, { rowId: "activity:b", index: 3 }, 1), undefined)
  assert.deepEqual(stepSquare(live, { rowId: "activity:b", index: 3 }, 1), { rowId: "activity:b", index: 4 })
})

test("an error with the provider's words is a visible row, not a square", () => {
  // The exact Claude Code message a Fable allowance ended two threads on, 2026-11-15.
  const limit: MessagePart = { type: "error", content: "You've hit your Fable limit · resets Nov 20, 9pm (Europe/Zurich). Switch to another model, or manage usage credits at https://claude.ai/settings/usage?from=cc_cli_limit_message, to continue." }
  assert.equal(isVisibleErrorPart(limit), true)
  assert.equal(isInspectablePart(limit), false)
  assert.deepEqual(squareSequence([{ id: "activity:a", parts: [part("tool_use", "Read"), part("tool_result"), limit] }]),
    [{ rowId: "activity:a", index: 0 }])
})

test("an error without words stays a square", () => {
  const blank: MessagePart = { type: "error", content: "  " }
  assert.equal(isVisibleErrorPart(blank), false)
  assert.equal(isInspectablePart(blank), true)
})
