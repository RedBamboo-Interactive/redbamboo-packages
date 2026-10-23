import assert from "node:assert/strict"
import { test } from "node:test"
import {
  activatePanel,
  dockStorageKey,
  emptyLayout,
  ensurePanel,
  findPanel,
  moveToZone,
  movePanel,
  parseLayout,
  removePanel,
  sanitizeLayout,
  serializeLayout,
  setCollapsed,
  setGroupSizes,
  setZoneSize,
  visibleLayout,
} from "./components/dock/layout.ts"

const ORDER = { inspector: 10, history: 20, console: 30, settings: 40 }
const orderOf = (id) => ORDER[id]

function shellLayout() {
  let layout = emptyLayout()
  layout = ensurePanel(layout, "list", { zone: "left", size: 320 })
  for (const id of ["settings", "console", "history"]) {
    layout = ensurePanel(layout, id, { zone: "right", order: ORDER[id], size: 360 }, orderOf)
  }
  return layout
}

const groupsOf = (layout, zone) => layout.zones[zone].map((group) => group.panels)

test("ensurePanel places new panels in their default zone, ordered, and seeds the zone size once", () => {
  const layout = shellLayout()
  assert.deepEqual(groupsOf(layout, "left"), [["list"]])
  assert.deepEqual(groupsOf(layout, "right"), [["history"], ["console"], ["settings"]])
  assert.equal(layout.zoneSizes.left, 320)
  assert.equal(layout.zoneSizes.right, 360)
  const again = ensurePanel(layout, "list", { zone: "right", size: 999 })
  assert.equal(again, layout, "a known panel keeps its placement and the same object")
  const sized = ensurePanel(layout, "inspector", { zone: "right", order: 10, size: 999 }, orderOf)
  assert.deepEqual(groupsOf(sized, "right")[0], ["inspector"])
  assert.equal(sized.zoneSizes.right, 360, "an existing zone size is not overwritten")
})

test("movePanel to a zone appends a new group and prunes the emptied source group", () => {
  const layout = movePanel(shellLayout(), "list", { kind: "zone", zone: "right" })
  assert.deepEqual(groupsOf(layout, "left"), [])
  assert.deepEqual(groupsOf(layout, "right"), [["history"], ["console"], ["settings"], ["list"]])
  assert.equal(findPanel(layout, "list").group.active, "list")
})

test("movePanel never mutates its input", () => {
  const before = shellLayout()
  const snapshot = JSON.stringify(before)
  movePanel(before, "console", { kind: "zone", zone: "bottom" })
  movePanel(before, "history", { kind: "tab", groupId: before.zones.right[2].id })
  movePanel(before, "list", { kind: "split", groupId: before.zones.right[0].id, side: "before" })
  assert.equal(JSON.stringify(before), snapshot)
})

test("tab target stacks panels and activates the moved one; the source group picks a neighbour", () => {
  let layout = shellLayout()
  const settingsGroup = findPanel(layout, "settings").group.id
  layout = movePanel(layout, "history", { kind: "tab", groupId: settingsGroup })
  assert.deepEqual(groupsOf(layout, "right"), [["console"], ["settings", "history"]])
  assert.equal(findPanel(layout, "history").group.active, "history")
  layout = movePanel(layout, "console", { kind: "tab", groupId: settingsGroup, index: 0 })
  assert.deepEqual(groupsOf(layout, "right"), [["console", "settings", "history"]])
  layout = movePanel(layout, "console", { kind: "zone", zone: "bottom" })
  assert.deepEqual(groupsOf(layout, "right"), [["settings", "history"]])
  assert.equal(layout.zones.right[0].active, "settings", "active falls to the tab that took the moved tab's index")
})

test("tab target inside the same group reorders without creating groups", () => {
  let layout = shellLayout()
  const group = findPanel(layout, "settings").group.id
  layout = movePanel(layout, "history", { kind: "tab", groupId: group })
  layout = movePanel(layout, "console", { kind: "tab", groupId: group })
  layout = movePanel(layout, "console", { kind: "tab", groupId: group, index: 0 })
  assert.deepEqual(groupsOf(layout, "right"), [["console", "settings", "history"]])
})

test("split target inserts a new group beside the anchor and halves a known size", () => {
  let layout = shellLayout()
  const consoleGroup = findPanel(layout, "console").group.id
  layout = setGroupSizes(layout, "right", { [consoleGroup]: 50 })
  layout = movePanel(layout, "list", { kind: "split", groupId: consoleGroup, side: "before" })
  assert.deepEqual(groupsOf(layout, "right"), [["history"], ["list"], ["console"], ["settings"]])
  assert.equal(findPanel(layout, "list").group.size, 25)
  assert.equal(findPanel(layout, "console").group.size, 25)
  const unchanged = movePanel(layout, "list", { kind: "split", groupId: findPanel(layout, "list").group.id, side: "after" })
  assert.equal(unchanged, layout, "splitting a lone panel off its own group is a no-op")
})

test("split works from a shared group into the same group", () => {
  let layout = shellLayout()
  const group = findPanel(layout, "settings").group.id
  layout = movePanel(layout, "history", { kind: "tab", groupId: group })
  layout = movePanel(layout, "history", { kind: "split", groupId: group, side: "after" })
  assert.deepEqual(groupsOf(layout, "right"), [["console"], ["settings"], ["history"]])
})

test("unknown targets leave the layout untouched", () => {
  const layout = shellLayout()
  assert.equal(movePanel(layout, "list", { kind: "tab", groupId: "nope" }), layout)
  assert.equal(movePanel(layout, "list", { kind: "split", groupId: "nope", side: "after" }), layout)
})

test("moveToZone is a no-op inside the current zone and generated group ids stay unique", () => {
  let layout = shellLayout()
  assert.equal(moveToZone(layout, "console", "right"), layout)
  layout = moveToZone(layout, "console", "bottom")
  layout = moveToZone(layout, "console", "right")
  layout = moveToZone(layout, "list", "bottom")
  const ids = ["left", "right", "bottom"].flatMap((zone) => layout.zones[zone].map((group) => group.id))
  assert.equal(new Set(ids).size, ids.length)
})

test("a new panel moved before it was ever placed is placed by the move", () => {
  const layout = movePanel(emptyLayout(), "fresh", { kind: "zone", zone: "bottom" })
  assert.deepEqual(groupsOf(layout, "bottom"), [["fresh"]])
})

test("removePanel forgets placement and collapsed state", () => {
  let layout = setCollapsed(shellLayout(), "list", true)
  layout = removePanel(layout, "list")
  assert.equal(findPanel(layout, "list"), null)
  assert.deepEqual(layout.collapsed, [])
  assert.equal(removePanel(layout, "list"), layout)
})

test("activatePanel switches tabs and is idempotent", () => {
  let layout = shellLayout()
  const group = findPanel(layout, "settings").group.id
  layout = movePanel(layout, "history", { kind: "tab", groupId: group })
  const switched = activatePanel(layout, "settings")
  assert.equal(findPanel(switched, "settings").group.active, "settings")
  assert.equal(activatePanel(switched, "settings"), switched)
})

test("visibleLayout hides unregistered and collapsed panels but keeps their placement", () => {
  let layout = shellLayout()
  const group = findPanel(layout, "settings").group.id
  layout = movePanel(layout, "history", { kind: "tab", groupId: group })
  layout = setCollapsed(layout, "list", true)
  const registered = new Set(["list", "settings"])
  const visible = visibleLayout(layout, (id) => registered.has(id))
  assert.deepEqual(visible.zones.left, [])
  assert.deepEqual(visible.collapsed.left, ["list"])
  assert.deepEqual(visible.zones.right.map((g) => [g.panels, g.active]), [[["settings"], "settings"]],
    "the active history tab is unregistered, so the group shows settings")
  assert.ok(findPanel(layout, "console"), "a closed panel keeps its placement")
})

test("zone and group sizes are validated and rounded", () => {
  let layout = shellLayout()
  assert.equal(setZoneSize(layout, "left", Number.NaN), layout)
  assert.equal(setZoneSize(layout, "left", 10), layout)
  layout = setZoneSize(layout, "left", 401.6)
  assert.equal(layout.zoneSizes.left, 402)
  assert.equal(setZoneSize(layout, "left", 402), layout)
  const group = layout.zones.right[0].id
  assert.equal(setGroupSizes(layout, "right", { [group]: -1 }), layout)
  assert.equal(setGroupSizes(layout, "right", { [group]: 33.3333 }).zones.right[0].size, 33.33)
})

test("serialize and parse round-trip", () => {
  let layout = movePanel(shellLayout(), "console", { kind: "zone", zone: "bottom" })
  layout = setCollapsed(layout, "list", true)
  layout = setZoneSize(layout, "bottom", 240)
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout)
})

test("parseLayout falls back to defaults on corrupt or foreign data", () => {
  const empty = emptyLayout()
  for (const raw of [null, "", "{", "null", "42", '"text"', "[]", '{"version":2,"zones":{"left":[{"id":"a","panels":["x"]}]}}', '{"zones":{}}']) {
    assert.deepEqual(parseLayout(raw), empty, `input ${raw}`)
  }
})

test("sanitizeLayout keeps the valid parts of damaged data", () => {
  const layout = sanitizeLayout({
    version: 1,
    zones: {
      left: [
        { id: "g:list", panels: ["list", 7, "", "list"], active: "missing", size: 120 },
        null,
        { id: "empty", panels: [] },
        "junk",
      ],
      right: [
        { id: "g:list", panels: ["console", "list"], active: "console", size: 40 },
        { panels: ["settings"] },
      ],
      bottom: "nope",
      floating: [{ id: "x", panels: ["ghost"] }],
    },
    zoneSizes: { left: 300.4, right: "wide", bottom: 5, center: 400 },
    collapsed: ["list", "list", "ghost", 3],
  })
  assert.deepEqual(layout.zones.left, [{ id: "g:list", panels: ["list"] }])
  assert.deepEqual(layout.zones.right.map((g) => g.panels), [["console"], ["settings"]],
    "a duplicate placement of list is dropped; the first one wins")
  assert.equal(layout.zones.right[0].active, "console")
  assert.equal(layout.zones.right[0].size, 40)
  assert.notEqual(layout.zones.right[0].id, "g:list", "a duplicate group id is regenerated")
  assert.equal(new Set([...layout.zones.left, ...layout.zones.right].map((g) => g.id)).size, 3)
  assert.deepEqual(layout.zones.bottom, [])
  assert.deepEqual(layout.zoneSizes, { left: 300 })
  assert.deepEqual(layout.collapsed, ["list"], "collapsed keeps only placed panels, once")
})

test("storage keys are per layout id and versioned", () => {
  assert.equal(dockStorageKey("redleaf:dock", "nova"), "redleaf:dock:nova:v1")
})
