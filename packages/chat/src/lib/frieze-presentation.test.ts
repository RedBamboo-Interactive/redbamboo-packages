import test from "node:test"
import assert from "node:assert/strict"
import type { MessageBlock, MessagePart } from "../types.ts"
import { projectActivityTimeline } from "./activity-timeline.ts"
import { findPairedResult } from "./background-work.ts"
import { friezeMarkerColor, friezeMarkerFailed, friezeSummaryText } from "./frieze-presentation.ts"
import { PART_COLOR } from "./part-colors.ts"
import { squareSequence } from "./part-navigation.ts"

test("Detailed preserves the existing color even for a failed or active marker", () => {
  assert.equal(friezeMarkerColor("detailed", PART_COLOR.readOnly, { failed: true, active: true }), PART_COLOR.readOnly)
  assert.equal(friezeMarkerColor("minimal", PART_COLOR.readOnly, { failed: true }), PART_COLOR.readOnly)
})

test("Quiet gives ordinary event, thinking and tool markers the same muted color", () => {
  const quiet = friezeMarkerColor("quiet", PART_COLOR.thinking)
  assert.match(quiet, /--color-text-disabled/)
  assert.equal(friezeMarkerColor("quiet", PART_COLOR.readOnly), quiet)
  assert.equal(friezeMarkerColor("quiet", PART_COLOR.delegation), quiet)
})

test("Quiet preserves attention colors and marks failed outcomes red", () => {
  assert.equal(friezeMarkerColor("quiet", PART_COLOR.thinking, { active: true }), PART_COLOR.thinking)
  assert.equal(friezeMarkerColor("quiet", PART_COLOR.delegation, { active: true }), PART_COLOR.delegation)
  assert.equal(friezeMarkerColor("quiet", PART_COLOR.mutating, { needsAttention: true }), PART_COLOR.mutating)
  assert.equal(friezeMarkerColor("quiet", PART_COLOR.readOnly, { failed: true }), PART_COLOR.error)
})

test("failed tool results count once, through their own launching markers", () => {
  const first: MessagePart = { type: "tool_use", toolName: "Read", toolUseId: "a", content: "" }
  const second: MessagePart = { ...first, toolUseId: "b" }
  const parts: MessagePart[] = [first, second, { type: "tool_result", toolUseId: "a", content: "Error: file missing" },
    { type: "tool_result", toolUseId: "b", content: "Contents" }]
  assert.equal(friezeMarkerFailed(first, findPairedResult(parts, first), PART_COLOR.readOnly), true)
  assert.equal(friezeMarkerFailed(second, findPairedResult(parts, second), PART_COLOR.readOnly), false)
  assert.equal(friezeMarkerFailed({ type: "error", content: "" }, undefined, PART_COLOR.error), true)
  assert.equal(friezeMarkerFailed(first, undefined, PART_COLOR.readOnly, true), true)
})

test("Minimal uses the filtered activity count and the existing empty-row rule", () => {
  const block: MessageBlock = { id: "events", role: "assistant", timestamp: "", parts: [
    { type: "tool_use", toolName: "event:weather", content: "" },
    { type: "tool_use", toolName: "event:callback", content: "" },
  ] }
  const rows = projectActivityTimeline([block], 0, undefined, part => part.toolName !== "event:callback")
  const count = squareSequence(rows.map(row => ({ id: row.key, parts: row.block.parts }))).length
  assert.equal(friezeSummaryText(count, true, false), "1 event")
  assert.equal(friezeSummaryText(2, true, false), "2 events")
  assert.equal(friezeSummaryText(37, false, false), "37 steps")
  assert.equal(friezeSummaryText(6, false, true), "Working · 6 steps")
  assert.deepEqual(projectActivityTimeline([block], 0, undefined, () => false), [])
})
