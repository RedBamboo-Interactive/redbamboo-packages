import assert from "node:assert/strict"
import { test } from "node:test"
import { dockPanelEntries } from "./components/dock/panel-actions.ts"

const zones = ["left", "right", "bottom"]
const ids = (entries) => entries.map((entry) => entry.id)

function handlers(calls) {
  return {
    moveToZone: (zone) => calls.push(`zone:${zone}`),
    moveToOwnLane: () => calls.push("own"),
    collapse: () => calls.push("collapse"),
    close: () => calls.push("close"),
  }
}

test("the grip menu's items, in its order, with the current zone disabled", () => {
  const calls = []
  const entries = dockPanelEntries({ zones, zone: "right", canMoveToOwnLane: true, collapsible: true, closable: true }, handlers(calls))
  assert.deepEqual(ids(entries), [
    "dock-move-left", "dock-move-right", "dock-move-bottom", "dock-own-column",
    "dock-collapse-separator", "dock-collapse", "dock-close-separator", "dock-close",
  ])
  assert.deepEqual(entries.slice(0, 3).map((entry) => [entry.label, entry.disabled]), [
    ["Move to left", false], ["Move to right", true], ["Move to bottom", false],
  ])
  for (const entry of entries) entry.run?.()
  assert.deepEqual(calls, ["zone:left", "zone:right", "zone:bottom", "own", "collapse", "close"])
})

test("bottom panels have no own column; fixed panels have no Collapse or Close", () => {
  const entries = dockPanelEntries({ zones, zone: "bottom", canMoveToOwnLane: false, collapsible: false, closable: false }, handlers([]))
  assert.deepEqual(ids(entries), ["dock-move-left", "dock-move-right", "dock-move-bottom"])
  const side = dockPanelEntries({ zones, zone: "left", canMoveToOwnLane: false, collapsible: false, closable: false }, handlers([]))
  assert.equal(side.find((entry) => entry.id === "dock-own-column").disabled, true)
})
