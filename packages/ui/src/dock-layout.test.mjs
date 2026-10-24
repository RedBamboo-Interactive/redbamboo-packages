import assert from "node:assert/strict"
import { test } from "node:test"
import {
  activatePanel,
  canMoveToOwnLane,
  computeFold,
  dockStorageKey,
  emptyLayout,
  ensurePanel,
  findPanel,
  isAloneInLane,
  moveToOwnLane,
  moveToZone,
  movePanel,
  parseLayout,
  removePanel,
  sanitizeLayout,
  serializeLayout,
  setCollapsed,
  setGroupSizes,
  setLaneSizes,
  visibleLayout,
  DOCK_CENTER_FLOOR,
} from "./components/dock/layout.ts"

const ORDER = { inspector: 10, history: 20, console: 30, settings: 40 }
const orderOf = (id) => ORDER[id]

/** The shell's default registrations: the list (left, list affinity), then tools (right). */
function shellLayout() {
  let layout = emptyLayout()
  layout = ensurePanel(layout, "list", { zone: "left", size: 320, affinity: "list" })
  for (const id of ["settings", "console", "history"]) {
    layout = ensurePanel(layout, id, { zone: "right", order: ORDER[id], size: 360, affinity: "tools" }, orderOf)
  }
  return layout
}

/** Panels per group per lane, lanes from the centre outward. */
const lanesOf = (layout, zone) => layout.zones[zone].map((lane) => lane.groups.map((group) => group.panels))
/** Panels per group, all lanes of a zone flattened. */
const groupsOf = (layout, zone) => layout.zones[zone].flatMap((lane) => lane.groups.map((group) => group.panels))
const laneOf = (layout, id) => findPanel(layout, id).lane.id
const allIds = (layout, kind) => ["left", "right", "bottom"].flatMap((zone) => kind === "lane"
  ? layout.zones[zone].map((lane) => lane.id)
  : layout.zones[zone].flatMap((lane) => lane.groups.map((group) => group.id)))
const panelIds = (layout) => ["left", "right", "bottom"].flatMap((zone) => groupsOf(layout, zone).flat())

function assertWellFormed(layout, step) {
  const groups = allIds(layout, "group")
  const lanes = allIds(layout, "lane")
  const panels = panelIds(layout)
  assert.equal(new Set(groups).size, groups.length, `${step}: unique group ids`)
  assert.equal(new Set(lanes).size, lanes.length, `${step}: unique lane ids`)
  assert.equal(new Set(panels).size, panels.length, `${step}: each panel placed once`)
  for (const zone of ["left", "right", "bottom"]) {
    for (const lane of layout.zones[zone]) {
      assert.ok(lane.groups.length > 0, `${step}: no empty lane`)
      for (const group of lane.groups) assert.ok(group.panels.length > 0, `${step}: no empty group`)
    }
  }
}

// --- defaults and affinity placement -----------------------------------------

test("default placement: list alone on the left, tools in one right lane ordered by `order`", () => {
  const layout = shellLayout()
  assert.deepEqual(lanesOf(layout, "left"), [[["list"]]])
  assert.deepEqual(lanesOf(layout, "right"), [[["history"], ["console"], ["settings"]]])
  assert.equal(layout.zones.left[0].size, 320)
  assert.equal(layout.zones.right[0].size, 360, "the first sized panel seeds its lane")
  assert.deepEqual(layout.affinity, { list: "list", settings: "tools", console: "tools", history: "tools" })
  const again = ensurePanel(layout, "list", { zone: "right", size: 999, affinity: "list" })
  assert.equal(again, layout, "a known panel keeps its placement and the same object")
  const sized = ensurePanel(layout, "inspector", { zone: "right", order: 10, size: 999, affinity: "tools" }, orderOf)
  assert.deepEqual(groupsOf(sized, "right")[0], ["inspector"])
  assert.equal(sized.zones.right[0].size, 360, "an existing lane size is not overwritten")
  assertWellFormed(sized, "defaults")
})

test("a share-sized first tool leaves its lane unsized, so it stays proportional", () => {
  let layout = ensurePanel(emptyLayout(), "settings", { zone: "right", affinity: "tools" })
  assert.equal(layout.zones.right[0].size, undefined)
  layout = ensurePanel(layout, "code-settings", { zone: "right", size: 360, affinity: "tools" })
  assert.equal(layout.zones.right.length, 1, "tools share a lane")
  assert.equal(layout.zones.right[0].size, 360, "a later pixel-sized panel seeds the unsized lane, as v1 did for the zone")
})

test("affinity: list moved right, then Settings opens -> centre | Settings | list", () => {
  let layout = ensurePanel(emptyLayout(), "list", { zone: "left", size: 320, affinity: "list" })
  layout = moveToZone(layout, "list", "right")
  assert.deepEqual(lanesOf(layout, "right"), [[["list"]]])
  assert.equal(layout.zones.right[0].size, 320, "the list's column keeps its width")
  assert.deepEqual(layout.zones.left, [], "the emptied lane is pruned")
  layout = ensurePanel(layout, "settings", { zone: "right", order: 40, affinity: "tools" }, orderOf)
  assert.deepEqual(lanesOf(layout, "right"), [[["settings"]], [["list"]]], "Settings gets a new inner lane")
  layout = ensurePanel(layout, "history", { zone: "right", order: 20, affinity: "tools" }, orderOf)
  assert.deepEqual(lanesOf(layout, "right"), [[["history"], ["settings"]], [["list"]]], "later tools join the tools lane, ordered")
  assertWellFormed(layout, "affinity")
})

test("affinity: a list moved into a zone that remembers a closed tool still lands at the screen edge", () => {
  let layout = shellLayout()
  // Settings, Console and History are closed: unregistered, placement remembered.
  layout = moveToZone(layout, "list", "right")
  assert.deepEqual(lanesOf(layout, "right"), [[["history"], ["console"], ["settings"]], [["list"]]])
  const visible = visibleLayout(layout, (id) => id === "list" || id === "settings")
  assert.deepEqual(visible.zones.right.map((lane) => lane.groups.map((group) => group.panels)), [[["settings"]], [["list"]]])
})

test("affinity: a tool joins the innermost lane of its kind, never the list's", () => {
  let layout = ensurePanel(emptyLayout(), "list", { zone: "right", affinity: "list" })
  layout = ensurePanel(layout, "console", { zone: "right", affinity: "tools" })
  layout = movePanel(layout, "console", { kind: "edge", zone: "right" })
  assert.deepEqual(lanesOf(layout, "right"), [[["list"]], [["console"]]])
  layout = ensurePanel(layout, "settings", { zone: "right", affinity: "tools" })
  assert.deepEqual(lanesOf(layout, "right"), [[["list"]], [["console"], ["settings"]]], "joins the console's lane, though it is outer")
})

test("affinity: a list first appearing beside tools takes the screen edge; panels without affinity are tools", () => {
  let layout = ensurePanel(emptyLayout(), "settings", { zone: "left", affinity: "tools" })
  layout = ensurePanel(layout, "list", { zone: "left", affinity: "list" })
  assert.deepEqual(lanesOf(layout, "left"), [[["settings"]], [["list"]]], "list | Settings | centre")
  const plain = ensurePanel(layout, "notes", { zone: "left" })
  assert.deepEqual(lanesOf(plain, "left"), [[["settings"], ["notes"]], [["list"]]])
})

test("a saved placement always wins over affinity; a re-declared affinity is recorded", () => {
  let layout = shellLayout()
  layout = movePanel(layout, "settings", { kind: "split", groupId: findPanel(layout, "list").group.id, side: "after" })
  const again = ensurePanel(layout, "settings", { zone: "right", order: 40, affinity: "tools" }, orderOf)
  assert.equal(again, layout)
  const relabelled = ensurePanel(layout, "settings", { zone: "right", affinity: "list" })
  assert.equal(relabelled.affinity.settings, "list")
  assert.equal(laneOf(relabelled, "settings"), laneOf(layout, "settings"))
})

test("the bottom zone keeps one lane whatever the affinity", () => {
  let layout = ensurePanel(emptyLayout(), "console", { zone: "bottom", affinity: "tools" })
  layout = ensurePanel(layout, "list", { zone: "bottom", affinity: "list" })
  layout = moveToZone(layout, "notes", "bottom")
  assert.deepEqual(lanesOf(layout, "bottom"), [[["console"], ["list"], ["notes"]]])
})

// --- moves -------------------------------------------------------------------

test("movePanel never mutates its input", () => {
  const before = shellLayout()
  const snapshot = JSON.stringify(before)
  const right = before.zones.right[0]
  movePanel(before, "console", { kind: "zone", zone: "bottom" })
  movePanel(before, "history", { kind: "tab", groupId: right.groups[2].id })
  movePanel(before, "list", { kind: "split", groupId: right.groups[0].id, side: "before" })
  movePanel(before, "list", { kind: "lane", laneId: right.id, side: "outer" })
  movePanel(before, "settings", { kind: "edge", zone: "left" })
  moveToOwnLane(before, "settings")
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
  assert.equal(layout.zones.right[0].groups[0].active, "settings", "active falls to the tab that took the moved tab's index")
})

test("tab target inside the same group reorders without creating groups", () => {
  let layout = shellLayout()
  const group = findPanel(layout, "settings").group.id
  layout = movePanel(layout, "history", { kind: "tab", groupId: group })
  layout = movePanel(layout, "console", { kind: "tab", groupId: group })
  layout = movePanel(layout, "console", { kind: "tab", groupId: group, index: 0 })
  assert.deepEqual(groupsOf(layout, "right"), [["console", "settings", "history"]])
})

test("split target inserts a new group beside the anchor, in the anchor's lane, and halves a known size", () => {
  let layout = shellLayout()
  const lane = layout.zones.right[0].id
  const consoleGroup = findPanel(layout, "console").group.id
  layout = setGroupSizes(layout, lane, { [consoleGroup]: 50 })
  layout = movePanel(layout, "list", { kind: "split", groupId: consoleGroup, side: "before" })
  assert.deepEqual(lanesOf(layout, "right"), [[["history"], ["list"], ["console"], ["settings"]]])
  assert.deepEqual(layout.zones.left, [], "the list's emptied lane is pruned")
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

test("lane target: a new lane on the inner or outer side of an existing lane", () => {
  let layout = shellLayout()
  layout = moveToZone(layout, "list", "right")
  const tools = laneOf(layout, "settings")
  const list = laneOf(layout, "list")
  // Settings to the outer edge of the list's lane, then to its inner edge.
  layout = movePanel(layout, "settings", { kind: "lane", laneId: list, side: "outer" })
  assert.deepEqual(lanesOf(layout, "right"), [[["history"], ["console"]], [["list"]], [["settings"]]])
  layout = movePanel(layout, "settings", { kind: "lane", laneId: list, side: "inner" })
  assert.deepEqual(lanesOf(layout, "right"), [[["history"], ["console"]], [["settings"]], [["list"]]])
  // Into the inner side of the first lane: becomes lane 0.
  layout = movePanel(layout, "history", { kind: "lane", laneId: tools, side: "inner" })
  assert.deepEqual(lanesOf(layout, "right"), [[["history"]], [["console"]], [["settings"]], [["list"]]])
  assertWellFormed(layout, "lanes")
})

test("lane target: empty-lane cleanup and no-ops beside the panel's own lane", () => {
  let layout = shellLayout()
  layout = moveToZone(layout, "list", "right")
  layout = movePanel(layout, "settings", { kind: "edge", zone: "right" })
  // Lanes: [tools(history, console)] [list] [settings]
  assert.deepEqual(lanesOf(layout, "right"), [[["history"], ["console"]], [["list"]], [["settings"]]])
  const own = laneOf(layout, "settings")
  const list = laneOf(layout, "list")
  assert.equal(movePanel(layout, "settings", { kind: "lane", laneId: own, side: "inner" }), layout, "own lane, inner")
  assert.equal(movePanel(layout, "settings", { kind: "lane", laneId: own, side: "outer" }), layout, "own lane, outer")
  assert.equal(movePanel(layout, "settings", { kind: "lane", laneId: list, side: "outer" }), layout, "the neighbour's facing side")
  assert.equal(movePanel(layout, "settings", { kind: "edge", zone: "right" }), layout, "already outermost")
  // Moving the list inward across the tools lane prunes its emptied lane.
  layout = movePanel(layout, "list", { kind: "lane", laneId: laneOf(layout, "history"), side: "inner" })
  assert.deepEqual(lanesOf(layout, "right"), [[["list"]], [["history"], ["console"]], [["settings"]]])
  layout = movePanel(layout, "list", { kind: "tab", groupId: findPanel(layout, "settings").group.id })
  assert.deepEqual(lanesOf(layout, "right"), [[["history"], ["console"]], [["settings", "list"]]], "the last group leaving a lane removes it")
  assertWellFormed(layout, "cleanup")
})

test("lane target carries the column width when the panel had its lane to itself", () => {
  let layout = shellLayout()
  layout = setLaneSizes(layout, { [laneOf(layout, "list")]: 300 })
  layout = movePanel(layout, "list", { kind: "edge", zone: "right" })
  assert.equal(findPanel(layout, "list").lane.size, 300)
  layout = movePanel(layout, "console", { kind: "lane", laneId: laneOf(layout, "list"), side: "inner" })
  assert.equal(findPanel(layout, "console").lane.size, undefined, "a panel leaving a shared lane takes no width along")
})

test("edge target adds the outermost lane, also across zones; unknown anchors are ignored", () => {
  let layout = shellLayout()
  layout = movePanel(layout, "console", { kind: "edge", zone: "left" })
  assert.deepEqual(lanesOf(layout, "left"), [[["list"]], [["console"]]], "console | list | centre")
  assert.equal(movePanel(layout, "list", { kind: "tab", groupId: "nope" }), layout)
  assert.equal(movePanel(layout, "list", { kind: "split", groupId: "nope", side: "after" }), layout)
  assert.equal(movePanel(layout, "list", { kind: "lane", laneId: "nope", side: "inner" }), layout)
})

test("moveToOwnLane: tools go toward the centre, a list toward the edge; disabled when alone or at the bottom", () => {
  let layout = shellLayout()
  layout = moveToZone(layout, "list", "right")
  layout = movePanel(layout, "settings", { kind: "split", groupId: findPanel(layout, "list").group.id, side: "after" })
  layout = movePanel(layout, "history", { kind: "tab", groupId: findPanel(layout, "list").group.id })
  // Lanes: [console] [list+history tabs, settings]
  assert.deepEqual(lanesOf(layout, "right"), [[["console"]], [["list", "history"], ["settings"]]])
  assert.ok(canMoveToOwnLane(layout, "settings"))
  layout = moveToOwnLane(layout, "settings")
  assert.deepEqual(lanesOf(layout, "right"), [[["console"]], [["settings"]], [["list", "history"]]], "tools: inner side")
  layout = moveToOwnLane(layout, "list")
  assert.deepEqual(lanesOf(layout, "right"), [[["console"]], [["settings"]], [["history"]], [["list"]]], "list: outer side")
  assert.equal(canMoveToOwnLane(layout, "list"), false)
  assert.equal(moveToOwnLane(layout, "list"), layout, "alone in its lane: no-op")
  layout = moveToZone(layout, "console", "bottom")
  layout = moveToZone(layout, "history", "bottom")
  assert.equal(canMoveToOwnLane(layout, "console"), false, "the bottom zone keeps one lane")
  assert.equal(moveToOwnLane(layout, "console"), layout)
  assertWellFormed(layout, "own lane")
})

test("moveToOwnLane counts only shown panels: a closed neighbour does not share the column", () => {
  let layout = shellLayout()
  const shown = (id) => id === "settings" || id === "list"
  assert.ok(isAloneInLane(layout, "settings", shown), "History and Console are closed")
  assert.equal(canMoveToOwnLane(layout, "settings", shown), false)
  assert.equal(moveToOwnLane(layout, "settings", shown), layout)
  assert.ok(canMoveToOwnLane(layout, "settings"), "with everything open it shares the lane")
})

test("moveToZone is a no-op inside the current zone and generated ids stay unique", () => {
  let layout = shellLayout()
  assert.equal(moveToZone(layout, "console", "right"), layout)
  layout = moveToZone(layout, "console", "bottom")
  layout = moveToZone(layout, "console", "right")
  layout = moveToZone(layout, "list", "bottom")
  layout = moveToZone(layout, "list", "left")
  layout = moveToOwnLane(layout, "console")
  layout = movePanel(layout, "history", { kind: "edge", zone: "right" })
  assertWellFormed(layout, "ids")
})

test("a new panel moved before it was ever placed is placed by the move", () => {
  const layout = movePanel(emptyLayout(), "fresh", { kind: "zone", zone: "bottom" })
  assert.deepEqual(groupsOf(layout, "bottom"), [["fresh"]])
  const edge = movePanel(emptyLayout(), "fresh", { kind: "edge", zone: "right" })
  assert.deepEqual(lanesOf(edge, "right"), [[["fresh"]]])
})

test("a zone move of a collapsed panel already in that zone only expands it", () => {
  let layout = setCollapsed(shellLayout(), "list", true)
  layout = movePanel(layout, "list", { kind: "zone", zone: "left" })
  assert.deepEqual(layout.collapsed, [])
  assert.deepEqual(lanesOf(layout, "left"), [[["list"]]])
})

test("removePanel forgets placement, collapsed state and affinity", () => {
  let layout = setCollapsed(shellLayout(), "list", true)
  layout = removePanel(layout, "list")
  assert.equal(findPanel(layout, "list"), null)
  assert.deepEqual(layout.collapsed, [])
  assert.equal(layout.affinity.list, undefined)
  assert.deepEqual(layout.zones.left, [], "its lane goes with it")
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

test("visibleLayout hides unregistered and collapsed panels; a lane of collapsed panels is a rail lane", () => {
  let layout = shellLayout()
  const group = findPanel(layout, "settings").group.id
  layout = movePanel(layout, "history", { kind: "tab", groupId: group })
  layout = setCollapsed(layout, "list", true)
  const registered = new Set(["list", "settings"])
  let visible = visibleLayout(layout, (id) => registered.has(id))
  assert.deepEqual(visible.zones.left.map((lane) => [lane.groups.length, lane.collapsed]), [[0, ["list"]]], "rail lane")
  assert.deepEqual(visible.collapsed.left, ["list"])
  assert.deepEqual(visible.zones.right.map((lane) => lane.groups.map((g) => [g.panels, g.active, g.laneId])),
    [[[["settings"], "settings", layout.zones.right[0].id]]],
    "the active history tab is unregistered, so the group shows settings")
  assert.ok(findPanel(layout, "console"), "a closed panel keeps its placement")

  // List collapsed in the outer lane beside an open Settings lane: centre | Settings | rail.
  layout = moveToZone(setCollapsed(layout, "list", false), "list", "right")
  layout = setCollapsed(layout, "list", true)
  visible = visibleLayout(layout, (id) => registered.has(id))
  assert.deepEqual(visible.zones.right.map((lane) => [lane.groups.length, lane.collapsed]), [[1, []], [0, ["list"]]])
  visible = visibleLayout(layout, () => false)
  assert.deepEqual(visible.zones.right, [], "lanes of closed panels take no room")
})

test("lane and group sizes are validated and rounded", () => {
  let layout = shellLayout()
  const left = layout.zones.left[0].id
  assert.equal(setLaneSizes(layout, { [left]: Number.NaN }), layout)
  assert.equal(setLaneSizes(layout, { [left]: 10 }), layout)
  assert.equal(setLaneSizes(layout, { nope: 400 }), layout)
  layout = setLaneSizes(layout, { [left]: 401.6 })
  assert.equal(layout.zones.left[0].size, 402)
  assert.equal(setLaneSizes(layout, { [left]: 402 }), layout)
  const lane = layout.zones.right[0]
  const group = lane.groups[0].id
  assert.equal(setGroupSizes(layout, lane.id, { [group]: -1 }), layout)
  assert.equal(setGroupSizes(layout, "nope", { [group]: 30 }), layout)
  assert.equal(setGroupSizes(layout, lane.id, { [group]: 33.3333 }).zones.right[0].groups[0].size, 33.33)
})

// --- persistence -------------------------------------------------------------

test("serialize and parse round-trip", () => {
  let layout = movePanel(shellLayout(), "console", { kind: "zone", zone: "bottom" })
  layout = moveToZone(layout, "list", "right")
  layout = setCollapsed(layout, "list", true)
  layout = setLaneSizes(layout, { [layout.zones.bottom[0].id]: 240, [laneOf(layout, "list")]: 330 })
  assert.deepEqual(parseLayout(serializeLayout(layout)), layout)
})

test("parseLayout falls back to defaults on corrupt or foreign data", () => {
  const empty = emptyLayout()
  for (const raw of [null, "", "{", "null", "42", '"text"', "[]", '{"version":3,"zones":{"left":[{"id":"a","groups":[{"id":"g","panels":["x"]}]}]}}', '{"zones":{}}']) {
    assert.deepEqual(parseLayout(raw), empty, `input ${raw}`)
  }
})

test("sanitizeLayout keeps the valid parts of damaged v2 data", () => {
  const layout = sanitizeLayout({
    version: 2,
    zones: {
      left: [
        { id: "l:list", size: 300.4, groups: [{ id: "g:list", panels: ["list", 7, "", "list"], active: "missing", size: 120 }, null, { id: "empty", panels: [] }, "junk"] },
        { id: "l:empty", groups: [] },
        "junk",
      ],
      right: [
        { id: "l:list", size: "wide", groups: [{ id: "g:list", panels: ["console", "list"], active: "console", size: 40 }, { panels: ["settings"] }] },
        { groups: [{ id: "g:history", panels: ["history"] }], size: 5 },
        { id: "l:nogroups" },
      ],
      bottom: "nope",
      floating: [{ id: "x", groups: [{ id: "x", panels: ["ghost"] }] }],
    },
    collapsed: ["list", "list", "ghost", 3],
    affinity: { list: "list", console: "sidebar", ghost: "tools", history: "tools" },
  })
  assert.deepEqual(layout.zones.left, [{ id: "l:list", size: 300, groups: [{ id: "g:list", panels: ["list"] }] }])
  assert.deepEqual(lanesOf(layout, "right"), [[["console"], ["settings"]], [["history"]]],
    "a duplicate placement of list is dropped; the first one wins")
  const [first, second] = layout.zones.right
  assert.notEqual(first.id, "l:list", "a duplicate lane id is regenerated")
  assert.equal(first.size, undefined)
  assert.equal(second.size, undefined, "a size below the minimum is dropped")
  assert.equal(first.groups[0].active, "console")
  assert.equal(first.groups[0].size, 40)
  assert.notEqual(first.groups[0].id, "g:list", "a duplicate group id is regenerated")
  assert.deepEqual(layout.zones.bottom, [])
  assert.deepEqual(layout.collapsed, ["list"], "collapsed keeps only placed panels, once")
  assert.deepEqual(layout.affinity, { list: "list", history: "tools" }, "affinity keeps placed panels with valid kinds")
  assertWellFormed(layout, "sanitize")
})

// --- v1 migration --------------------------------------------------------------

test("v1 migration: the tester's shape (list alone on the right) becomes one right lane, then Settings opens beside it", () => {
  const v1 = {
    version: 1,
    zones: { left: [], right: [{ id: "g:list", panels: ["list"], active: "list" }], bottom: [] },
    zoneSizes: { left: 320, right: 344 },
    collapsed: [],
  }
  let layout = parseLayout(JSON.stringify(v1))
  assert.equal(layout.version, 2)
  assert.deepEqual(layout.zones.right, [{ id: "l:list", size: 344, groups: [{ id: "g:list", panels: ["list"], active: "list" }] }])
  assert.deepEqual(layout.zones.left, [], "a zone size without groups has nothing to size")
  layout = ensurePanel(layout, "list", { zone: "left", affinity: "list" })
  assert.equal(laneOf(layout, "list"), "l:list", "the saved placement wins over the default zone")
  layout = ensurePanel(layout, "settings", { zone: "right", order: 40, affinity: "tools" }, orderOf)
  assert.deepEqual(lanesOf(layout, "right"), [[["settings"]], [["list"]]], "centre | Settings | list")
  assert.equal(layout.zones.right[1].size, 344, "the list keeps its width")
})

test("v1 migration: Settings and History tabbed in a right group, sizes, collapse and a bottom zone survive", () => {
  const v1 = {
    version: 1,
    zones: {
      left: [{ id: "g:list", panels: ["list"], active: "list" }],
      right: [
        { id: "g:settings", panels: ["settings", "history"], active: "history", size: 62.5 },
        { id: "g:inspector", panels: ["inspector"], size: 37.5 },
      ],
      bottom: [{ id: "g:console", panels: ["console"] }],
    },
    zoneSizes: { left: 288, right: 410, bottom: 240 },
    collapsed: ["list"],
  }
  const layout = sanitizeLayout(v1)
  assert.deepEqual(layout.zones.left, [{ id: "l:list", size: 288, groups: [{ id: "g:list", panels: ["list"], active: "list" }] }])
  assert.deepEqual(layout.zones.right, [{
    id: "l:settings",
    size: 410,
    groups: [
      { id: "g:settings", panels: ["settings", "history"], active: "history", size: 62.5 },
      { id: "g:inspector", panels: ["inspector"], size: 37.5 },
    ],
  }])
  assert.deepEqual(layout.zones.bottom, [{ id: "l:console", size: 240, groups: [{ id: "g:console", panels: ["console"] }] }])
  assert.deepEqual(layout.collapsed, ["list"])
  assert.deepEqual(layout.affinity, {}, "v1 knew no affinities; registration records them")
  assertWellFormed(layout, "migration")
  // A v1 stack stays a stack: the saved placement wins, "Move to own column" splits it.
  const reopened = ensurePanel(layout, "settings", { zone: "right", affinity: "tools" })
  assert.deepEqual(lanesOf(reopened, "right"), lanesOf(layout, "right"))
})

test("v1 migration is as tolerant as v1 loading was", () => {
  const layout = sanitizeLayout({
    version: 1,
    zones: {
      left: [{ id: "g:list", panels: ["list", 7, "", "list"], active: "missing", size: 120 }, null, { id: "empty", panels: [] }, "junk"],
      right: [{ id: "g:list", panels: ["console", "list"], active: "console", size: 40 }, { panels: ["settings"] }],
      bottom: "nope",
      floating: [{ id: "x", panels: ["ghost"] }],
    },
    zoneSizes: { left: 300.4, right: "wide", bottom: 5, center: 400 },
    collapsed: ["list", "list", "ghost", 3],
  })
  assert.deepEqual(layout.zones.left, [{ id: "l:list", size: 300, groups: [{ id: "g:list", panels: ["list"] }] }])
  assert.deepEqual(lanesOf(layout, "right"), [[["console"], ["settings"]]])
  assert.equal(layout.zones.right[0].size, undefined)
  assert.notEqual(layout.zones.right[0].groups[0].id, "g:list")
  assert.deepEqual(layout.collapsed, ["list"])
  assertWellFormed(layout, "tolerant migration")
})

test("storage keys are per layout id and versioned", () => {
  assert.equal(dockStorageKey("redleaf:dock", "nova"), "redleaf:dock:nova:v2")
  assert.equal(dockStorageKey("redleaf:dock", "nova", 1), "redleaf:dock:nova:v1")
})

// --- folding -------------------------------------------------------------------

const fold = (frameWidth, lanes) => computeFold({ frameWidth, floor: DOCK_CENTER_FLOOR, separator: 1, lanes })

test("fold: centre | Settings | list fits at 1440 and 1920 and folds at 1280 (default 320 list, 26.3% Settings)", () => {
  const share = 0.263259
  for (const [width, folded] of [[1920, false], [1440, false], [1280, true]]) {
    assert.deepEqual(fold(width, { right: [Math.round(width * share), 320] }), { left: false, right: folded }, `${width}px`)
  }
})

test("fold: a single lane never folds, the threshold is exact, and an unmeasured frame folds nothing", () => {
  assert.deepEqual(fold(700, { left: [320], right: [400] }), { left: false, right: false })
  // 300 + 300 + 2 separators + 640 = 1242
  assert.deepEqual(fold(1242, { right: [300, 300] }), { left: false, right: false })
  assert.deepEqual(fold(1241, { right: [300, 300] }), { left: false, right: true })
  assert.deepEqual(fold(0, { right: [300, 300] }), { left: false, right: false })
})

test("fold: the other side's width counts; the side with more lanes folds first, then both if needed", () => {
  // Left 2 lanes (600), right 3 lanes (900): needs 1505 + 640.
  const lanes = { left: [300, 300], right: [300, 300, 300] }
  assert.deepEqual(fold(2200, lanes), { left: false, right: false })
  assert.deepEqual(fold(1900, lanes), { left: false, right: true }, "folding the right (3 lanes) is enough")
  assert.deepEqual(fold(1200, lanes), { left: true, right: true })
  // Equal lane counts: the wider saving folds first (301px against 201px here), the right on a tie.
  assert.deepEqual(fold(1500, { left: [200, 200], right: [300, 300] }), { left: false, right: true })
  assert.deepEqual(fold(1500, { left: [300, 300], right: [200, 200] }), { left: true, right: false })
  assert.deepEqual(fold(1600, { left: [300, 300], right: [300, 300] }), { left: false, right: true })
})
