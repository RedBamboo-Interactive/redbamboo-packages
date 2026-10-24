// Pure dock layout model. No React, no DOM: everything here is unit-tested.
//
// A layout places panel ids into three zones around a fixed centre. Each zone
// holds lanes: in the left and right zones a lane is a column, ordered from the
// centre outward (index 0 touches the centre) on both sides. Each lane holds
// groups split along the zone's cross axis (side lanes stack vertically, the
// bottom stacks horizontally); each group is a tab stack. The bottom zone keeps
// one lane in practice: the model allows more, the UI offers no target for it.
//
// The model remembers panels that are not currently registered (a closed
// Console keeps its placement), and `visibleLayout` filters down to what is
// actually rendered.

export type DockZone = "left" | "right" | "bottom"

export const DOCK_ZONES: readonly DockZone[] = ["left", "right", "bottom"]

/**
 * What a panel is, for placement: the app's `list` (MasterDetailLayout) stays
 * pinned to the screen edge, `tools` (Inspector, History, Console, Settings…)
 * sit beside the centre. A new panel joins a lane of its own kind.
 */
export type DockAffinity = "list" | "tools"

export const DOCK_LAYOUT_VERSION = 2

/** The single-column format that shipped first. Still read, and migrated, never reset. */
export const LEGACY_DOCK_LAYOUT_VERSION = 1

export interface DockGroup {
  id: string
  panels: string[]
  active?: string
  /** Share of the lane along its stacking axis, in percent. */
  size?: number
}

export interface DockLane {
  id: string
  groups: DockGroup[]
  /** Lane thickness in pixels (width for left/right, height for bottom). */
  size?: number
  /**
   * Migrated from a v1 zone, which could only stack. Normalized once, when the
   * affinity of every panel in it is known (see `normalizeLegacyLanes`), then
   * dropped. Lanes the user builds never carry it.
   */
  legacy?: true
}

export interface DockLayout {
  version: typeof DOCK_LAYOUT_VERSION
  zones: Record<DockZone, DockLane[]>
  collapsed: string[]
  /** Last declared affinity of each placed panel, so a closed panel's lane still has a kind. */
  affinity: Record<string, DockAffinity>
}

export type DockTarget =
  /** The zone itself, placed by affinity: a lane of the panel's kind, else a new lane. */
  | { kind: "zone"; zone: DockZone }
  | { kind: "tab"; groupId: string; index?: number }
  | { kind: "split"; groupId: string; side: "before" | "after" }
  /** A new lane beside an existing one, toward the centre (inner) or the screen edge (outer). */
  | { kind: "lane"; laneId: string; side: "inner" | "outer" }
  /** A new outermost lane of the zone. */
  | { kind: "edge"; zone: DockZone }

export interface DockPanelPlacementDefaults {
  zone: DockZone
  order?: number
  size?: number
  affinity?: DockAffinity
}

export interface VisibleDockGroup {
  id: string
  zone: DockZone
  laneId: string
  panels: string[]
  active: string
  size?: number
}

export interface VisibleDockLane {
  id: string
  zone: DockZone
  groups: VisibleDockGroup[]
  /** Registered, collapsed panels of this lane, in placement order. */
  collapsed: string[]
  size?: number
}

export interface VisibleDockLayout {
  /** Lanes with anything to show, ordered from the centre outward. */
  zones: Record<DockZone, VisibleDockLane[]>
  /** Registered, collapsed panels per zone, in placement order. */
  collapsed: Record<DockZone, string[]>
}

export const MIN_ZONE_SIZE = 48
export const MAX_ZONE_SIZE = 10000
const MAX_ID_LENGTH = 200

export function emptyLayout(): DockLayout {
  return {
    version: DOCK_LAYOUT_VERSION,
    zones: { left: [], right: [], bottom: [] },
    collapsed: [],
    affinity: {},
  }
}

export function isDockZone(value: unknown): value is DockZone {
  return value === "left" || value === "right" || value === "bottom"
}

export function isDockAffinity(value: unknown): value is DockAffinity {
  return value === "list" || value === "tools"
}

function cloneLayout(layout: DockLayout): DockLayout {
  return {
    version: DOCK_LAYOUT_VERSION,
    zones: {
      left: layout.zones.left.map(cloneLane),
      right: layout.zones.right.map(cloneLane),
      bottom: layout.zones.bottom.map(cloneLane),
    },
    collapsed: [...layout.collapsed],
    affinity: { ...layout.affinity },
  }
}

function cloneLane(lane: DockLane): DockLane {
  return { ...lane, groups: lane.groups.map(cloneGroup) }
}

function cloneGroup(group: DockGroup): DockGroup {
  return { ...group, panels: [...group.panels] }
}

// --- lookup ----------------------------------------------------------------

export interface PanelLocation {
  zone: DockZone
  laneIndex: number
  lane: DockLane
  groupIndex: number
  group: DockGroup
  index: number
}

export function findPanel(layout: DockLayout, panelId: string): PanelLocation | null {
  for (const zone of DOCK_ZONES) {
    const lanes = layout.zones[zone]
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex]!
      for (let groupIndex = 0; groupIndex < lane.groups.length; groupIndex += 1) {
        const group = lane.groups[groupIndex]!
        const index = group.panels.indexOf(panelId)
        if (index >= 0) return { zone, laneIndex, lane, groupIndex, group, index }
      }
    }
  }
  return null
}

export interface GroupLocation {
  zone: DockZone
  laneIndex: number
  lane: DockLane
  index: number
  group: DockGroup
}

export function findGroup(layout: DockLayout, groupId: string): GroupLocation | null {
  for (const zone of DOCK_ZONES) {
    const lanes = layout.zones[zone]
    for (let laneIndex = 0; laneIndex < lanes.length; laneIndex += 1) {
      const lane = lanes[laneIndex]!
      const index = lane.groups.findIndex((group) => group.id === groupId)
      if (index >= 0) return { zone, laneIndex, lane, index, group: lane.groups[index]! }
    }
  }
  return null
}

export function findLane(layout: DockLayout, laneId: string): { zone: DockZone; index: number; lane: DockLane } | null {
  for (const zone of DOCK_ZONES) {
    const index = layout.zones[zone].findIndex((lane) => lane.id === laneId)
    if (index >= 0) return { zone, index, lane: layout.zones[zone][index]! }
  }
  return null
}

function allGroupIds(layout: DockLayout): Set<string> {
  const ids = new Set<string>()
  for (const zone of DOCK_ZONES) for (const lane of layout.zones[zone]) for (const group of lane.groups) ids.add(group.id)
  return ids
}

function allLaneIds(layout: DockLayout): Set<string> {
  const ids = new Set<string>()
  for (const zone of DOCK_ZONES) for (const lane of layout.zones[zone]) ids.add(lane.id)
  return ids
}

function uniqueId(taken: ReadonlySet<string>, base: string): string {
  if (!taken.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}:${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Deterministic group id derived from the panel that founds the group. */
export function uniqueGroupId(taken: ReadonlySet<string>, panelId: string): string {
  return uniqueId(taken, `g:${panelId}`)
}

/** Deterministic lane id derived from the panel that founds the lane. */
export function uniqueLaneId(taken: ReadonlySet<string>, panelId: string): string {
  return uniqueId(taken, `l:${panelId}`)
}

/** A panel's placement affinity; panels that never declared one are tools. */
export function affinityOf(layout: DockLayout, panelId: string): DockAffinity {
  return layout.affinity[panelId] ?? "tools"
}

function laneHasAffinity(layout: DockLayout, lane: DockLane, affinity: DockAffinity): boolean {
  return lane.groups.some((group) => group.panels.some((id) => affinityOf(layout, id) === affinity))
}

/**
 * True when no other shown panel shares the panel's lane, so it already has a
 * column of its own. `isShown` filters out closed or collapsed panels, which
 * keep their placement but take no room.
 */
export function isAloneInLane(layout: DockLayout, panelId: string, isShown: (panelId: string) => boolean = () => true): boolean {
  const location = findPanel(layout, panelId)
  if (!location) return false
  return location.lane.groups.every((group) => group.panels.every((id) => id === panelId || !isShown(id)))
}

/** "Move to own column": available for a side-zone panel that shares its lane with a shown panel. */
export function canMoveToOwnLane(layout: DockLayout, panelId: string, isShown: (panelId: string) => boolean = () => true): boolean {
  const location = findPanel(layout, panelId)
  return !!location && location.zone !== "bottom" && !isAloneInLane(layout, panelId, isShown)
}

// --- mutation helpers (on drafts) ------------------------------------------

/** Removes a panel from wherever it is placed, pruning a group and a lane it leaves empty. Mutates `draft`. */
function detach(draft: DockLayout, panelId: string): void {
  const location = findPanel(draft, panelId)
  if (!location) return
  const { zone, laneIndex, lane, groupIndex, group, index } = location
  group.panels.splice(index, 1)
  if (group.panels.length === 0) {
    lane.groups.splice(groupIndex, 1)
    if (lane.groups.length === 0) draft.zones[zone].splice(laneIndex, 1)
    return
  }
  if (group.active === panelId) {
    group.active = group.panels[Math.min(index, group.panels.length - 1)]
  }
}

function newGroup(draft: DockLayout, panelId: string): DockGroup {
  return { id: uniqueGroupId(allGroupIds(draft), panelId), panels: [panelId], active: panelId }
}

function newLane(draft: DockLayout, panelId: string, size: number | undefined): DockLane {
  const lane: DockLane = { id: uniqueLaneId(allLaneIds(draft), panelId), groups: [newGroup(draft, panelId)] }
  if (isZoneSize(size)) lane.size = Math.round(size)
  return lane
}

interface PlaceOptions {
  /** Default stacking order; the new group goes before the first group holding a later panel. */
  order?: number
  orderOf?: (panelId: string) => number | undefined
  /** Thickness for a lane this placement creates (or seeds, when the joined lane has none). */
  size?: number
}

/**
 * Places a detached panel in a zone by affinity: it joins the innermost lane
 * holding a panel of the same kind, else gets a new lane, toward the centre for
 * tools and at the screen edge for a list. The bottom zone always uses its
 * first lane. Mutates `draft`.
 */
function placeInZone(draft: DockLayout, panelId: string, zone: DockZone, affinity: DockAffinity, options: PlaceOptions = {}): void {
  const lanes = draft.zones[zone]
  const lane = zone === "bottom" ? lanes[0] : lanes.find((candidate) => laneHasAffinity(draft, candidate, affinity))
  if (!lane) {
    const created = newLane(draft, panelId, options.size)
    if (zone !== "bottom" && affinity === "list") lanes.push(created)
    else lanes.unshift(created)
    return
  }
  const group = newGroup(draft, panelId)
  let index = lane.groups.length
  const { order, orderOf } = options
  if (order !== undefined && orderOf) {
    const found = lane.groups.findIndex((candidate) => candidate.panels.some((id) => {
      const other = orderOf(id)
      return other !== undefined && other > order
    }))
    if (found >= 0) index = found
  }
  lane.groups.splice(index, 0, group)
  if (lane.size === undefined && isZoneSize(options.size)) lane.size = Math.round(options.size)
}

/** The panel is the only thing placed in its lane (shown or not). */
function soleInLane(location: PanelLocation): boolean {
  return location.lane.groups.length === 1 && location.group.panels.length === 1
}

/** The lane width a panel takes along when it moves into a new lane: its column's, if the column was its own. */
function carriedSize(location: PanelLocation | null): number | undefined {
  return location && soleInLane(location) ? location.lane.size : undefined
}

function uncollapse(draft: DockLayout, panelId: string) {
  draft.collapsed = draft.collapsed.filter((id) => id !== panelId)
}

// --- actions ---------------------------------------------------------------

/** Forgets a panel's placement entirely. */
export function removePanel(layout: DockLayout, panelId: string): DockLayout {
  if (!findPanel(layout, panelId) && !layout.collapsed.includes(panelId) && !(panelId in layout.affinity)) return layout
  const draft = cloneLayout(layout)
  detach(draft, panelId)
  uncollapse(draft, panelId)
  delete draft.affinity[panelId]
  return draft
}

export function movePanel(layout: DockLayout, panelId: string, target: DockTarget): DockLayout {
  const source = findPanel(layout, panelId)

  if (target.kind === "tab") {
    const destination = findGroup(layout, target.groupId)
    if (!destination) return layout
    const draft = cloneLayout(layout)
    uncollapse(draft, panelId)
    const group = findGroup(draft, target.groupId)!.group
    const existing = group.panels.indexOf(panelId)
    if (existing >= 0) {
      if (target.index !== undefined) {
        group.panels.splice(existing, 1)
        group.panels.splice(clampIndex(target.index, group.panels.length), 0, panelId)
      }
      group.active = panelId
      return draft
    }
    detach(draft, panelId)
    const index = target.index === undefined ? group.panels.length : clampIndex(target.index, group.panels.length)
    group.panels.splice(index, 0, panelId)
    group.active = panelId
    return draft
  }

  if (target.kind === "split") {
    const destination = findGroup(layout, target.groupId)
    if (!destination) return layout
    if (source && source.group.id === target.groupId && source.group.panels.length === 1) return layout
    const draft = cloneLayout(layout)
    uncollapse(draft, panelId)
    detach(draft, panelId)
    const anchor = findGroup(draft, target.groupId)
    if (!anchor) return layout
    const created = newGroup(draft, panelId)
    if (anchor.group.size !== undefined) {
      const half = anchor.group.size / 2
      anchor.group.size = half
      created.size = half
    }
    anchor.lane.groups.splice(target.side === "before" ? anchor.index : anchor.index + 1, 0, created)
    return draft
  }

  if (target.kind === "lane") {
    const anchor = findLane(layout, target.laneId)
    if (!anchor) return layout
    const insertAt = target.side === "inner" ? anchor.index : anchor.index + 1
    // A panel that already has its own lane, dropped right beside that lane, stays put.
    const ownLane = source !== null && soleInLane(source) && source.zone === anchor.zone
    if (ownLane && (insertAt === source!.laneIndex || insertAt === source!.laneIndex + 1)) return layout
    const size = carriedSize(source)
    const draft = cloneLayout(layout)
    uncollapse(draft, panelId)
    detach(draft, panelId)
    // Detaching prunes the panel's own lane, which shifts the lanes outward of it.
    const shift = ownLane && source!.laneIndex < insertAt ? 1 : 0
    draft.zones[anchor.zone].splice(insertAt - shift, 0, newLane(draft, panelId, size))
    return draft
  }

  if (target.kind === "edge") {
    const lanes = layout.zones[target.zone]
    if (source && soleInLane(source) && source.zone === target.zone && source.laneIndex === lanes.length - 1) return layout
    const size = carriedSize(source)
    const draft = cloneLayout(layout)
    uncollapse(draft, panelId)
    detach(draft, panelId)
    draft.zones[target.zone].push(newLane(draft, panelId, size))
    return draft
  }

  // Zone: placed by affinity. A panel already in the zone only expands.
  const draft = cloneLayout(layout)
  uncollapse(draft, panelId)
  if (source?.zone === target.zone) return draft.collapsed.length === layout.collapsed.length ? layout : draft
  const size = carriedSize(source)
  detach(draft, panelId)
  placeInZone(draft, panelId, target.zone, affinityOf(draft, panelId), { size })
  return draft
}

/** Keyboard/palette move: no-op when the panel already lives in that zone. */
export function moveToZone(layout: DockLayout, panelId: string, zone: DockZone): DockLayout {
  const source = findPanel(layout, panelId)
  if (source?.zone === zone) return layout
  return movePanel(layout, panelId, { kind: "zone", zone })
}

/**
 * "Move to own column": a new lane beside the panel's current one, toward the
 * centre for tools and toward the screen edge for a list. A no-op when the panel
 * already has its lane to itself (among shown panels) or lives in the bottom zone.
 */
export function moveToOwnLane(layout: DockLayout, panelId: string, isShown: (panelId: string) => boolean = () => true): DockLayout {
  if (!canMoveToOwnLane(layout, panelId, isShown)) return layout
  const location = findPanel(layout, panelId)!
  const side = affinityOf(layout, panelId) === "list" ? "outer" : "inner"
  return movePanel(layout, panelId, { kind: "lane", laneId: location.lane.id, side })
}

export function activatePanel(layout: DockLayout, panelId: string): DockLayout {
  const location = findPanel(layout, panelId)
  if (!location || location.group.active === panelId) return layout
  const draft = cloneLayout(layout)
  findPanel(draft, panelId)!.group.active = panelId
  return draft
}

/**
 * Places a newly registered panel in its default zone if the layout does not
 * know it yet: it joins the innermost lane whose panels share its affinity (as
 * a new group, ordered by `order`), else gets a new lane (see `placeInZone`).
 * A saved placement always wins; a known panel only has its affinity recorded.
 */
export function ensurePanel(
  layout: DockLayout,
  panelId: string,
  defaults: DockPanelPlacementDefaults,
  orderOf: (panelId: string) => number | undefined = () => undefined,
): DockLayout {
  const affinity = defaults.affinity
  if (findPanel(layout, panelId)) {
    if (!affinity || layout.affinity[panelId] === affinity) return normalizeLegacyLanes(layout)
    const draft = cloneLayout(layout)
    draft.affinity[panelId] = affinity
    return normalizeLegacyLanes(draft)
  }
  const draft = cloneLayout(layout)
  if (affinity) draft.affinity[panelId] = affinity
  placeInZone(draft, panelId, defaults.zone, affinityOf(draft, panelId), { order: defaults.order, orderOf, size: defaults.size })
  return normalizeLegacyLanes(draft)
}

/**
 * The affinity a panel has declared, or null while it is unknown. Registration
 * always records one (a panel that declares none is recorded as "tools"), so a
 * panel is unknown only if it has not registered since its layout was migrated
 * from v1. `affinityOf` treats unknown panels as tools for placement; legacy
 * normalization does not guess and waits for them.
 */
export function knownAffinity(layout: DockLayout, panelId: string): DockAffinity | null {
  return layout.affinity[panelId] ?? null
}

/** A group's kind: all its tabs share one affinity, or it mixes them (an explicit user choice). */
function groupAffinity(layout: DockLayout, group: DockGroup): DockAffinity | "mixed" {
  const kinds = new Set(group.panels.map((id) => affinityOf(layout, id)))
  return kinds.size === 1 ? [...kinds][0]! : "mixed"
}

/** Rescales group shares so a lane's sizes still add up after groups left it; relative sizes are kept. */
function rescaleGroups(groups: DockGroup[]) {
  if (!groups.every((group) => group.size !== undefined)) return
  const total = groups.reduce((sum, group) => sum + group.size!, 0)
  if (!(total > 0)) return
  for (const group of groups) group.size = Math.round((group.size! / total) * 10000) / 100
}

/**
 * v1 could only stack, so a v1 zone holding the list and tool panels (the list
 * docked right, then Settings opened) became one stacked lane. Once the
 * affinity of every panel in such a legacy lane is known, its whole-tools
 * groups move, in order and with their tabs, active tab and relative sizes, to
 * a new lane on its centre side; list groups and groups mixing list and tools
 * as tabs stay in the original lane, which keeps its width. Either way the
 * legacy flag is then dropped, so this runs once per lane. A lane with any
 * panel of unknown affinity is left alone (flag kept). The bottom zone keeps
 * its single lane. Lanes without the flag (built in v2) are never touched.
 */
export function normalizeLegacyLanes(layout: DockLayout): DockLayout {
  const ready = (lane: DockLane) => lane.legacy
    && lane.groups.every((group) => group.panels.every((id) => knownAffinity(layout, id) !== null))
  if (!DOCK_ZONES.some((zone) => layout.zones[zone].some(ready))) return layout
  const draft = cloneLayout(layout)
  for (const zone of DOCK_ZONES) {
    const lanes = draft.zones[zone]
    for (let index = 0; index < lanes.length; index += 1) {
      const lane = lanes[index]!
      if (!ready(lane)) continue
      delete lane.legacy
      if (zone === "bottom") continue
      const kinds = lane.groups.map((group) => groupAffinity(draft, group))
      const tools = lane.groups.filter((_, at) => kinds[at] === "tools")
      if (tools.length === 0 || tools.length === lane.groups.length) continue
      lane.groups = lane.groups.filter((_, at) => kinds[at] !== "tools")
      rescaleGroups(lane.groups)
      rescaleGroups(tools)
      const toolsLane: DockLane = { id: uniqueLaneId(allLaneIds(draft), tools[0]!.panels[0]!), groups: tools }
      lanes.splice(index, 0, toolsLane)
      index += 1
    }
  }
  return draft
}

/** Stores lane thicknesses in pixels; unknown lanes and invalid sizes are ignored. */
export function setLaneSizes(layout: DockLayout, sizes: Record<string, number>): DockLayout {
  let changed = false
  const draft = cloneLayout(layout)
  for (const zone of DOCK_ZONES) {
    for (const lane of draft.zones[zone]) {
      const size = sizes[lane.id]
      if (!isZoneSize(size)) continue
      const rounded = Math.round(size)
      if (lane.size !== rounded) {
        lane.size = rounded
        changed = true
      }
    }
  }
  return changed ? draft : layout
}

export function setGroupSizes(layout: DockLayout, laneId: string, sizes: Record<string, number>): DockLayout {
  const target = findLane(layout, laneId)
  if (!target) return layout
  let changed = false
  const draft = cloneLayout(layout)
  for (const group of draft.zones[target.zone][target.index]!.groups) {
    const size = sizes[group.id]
    if (!isGroupSize(size)) continue
    const rounded = Math.round(size * 100) / 100
    if (group.size !== rounded) {
      group.size = rounded
      changed = true
    }
  }
  return changed ? draft : layout
}

export function setCollapsed(layout: DockLayout, panelId: string, collapsed: boolean): DockLayout {
  const has = layout.collapsed.includes(panelId)
  if (has === collapsed) return layout
  const draft = cloneLayout(layout)
  draft.collapsed = collapsed ? [...draft.collapsed, panelId] : draft.collapsed.filter((id) => id !== panelId)
  return draft
}

export function visibleLayout(layout: DockLayout, isRegistered: (panelId: string) => boolean): VisibleDockLayout {
  const collapsedSet = new Set(layout.collapsed)
  const zones = { left: [], right: [], bottom: [] } as Record<DockZone, VisibleDockLane[]>
  const collapsed = { left: [], right: [], bottom: [] } as Record<DockZone, string[]>
  for (const zone of DOCK_ZONES) {
    for (const lane of layout.zones[zone]) {
      const groups: VisibleDockGroup[] = []
      const laneCollapsed: string[] = []
      for (const group of lane.groups) {
        const panels: string[] = []
        for (const id of group.panels) {
          if (!isRegistered(id)) continue
          if (collapsedSet.has(id)) laneCollapsed.push(id)
          else panels.push(id)
        }
        if (panels.length === 0) continue
        const active = group.active !== undefined && panels.includes(group.active) ? group.active : panels[0]!
        groups.push({ id: group.id, zone, laneId: lane.id, panels, active, size: group.size })
      }
      collapsed[zone].push(...laneCollapsed)
      if (groups.length === 0 && laneCollapsed.length === 0) continue
      zones[zone].push({ id: lane.id, zone, groups, collapsed: laneCollapsed, size: lane.size })
    }
  }
  return { zones, collapsed }
}

// --- folding ---------------------------------------------------------------

/**
 * The centre's minimum width while lanes sit side by side. Nova's and Code's
 * transcript and composer are laid out for a 768px column (`max-w-3xl`) with
 * 16px gutters: 640px keeps a 608px text column, about 75 characters a line at
 * the chat's 14px, with the composer's actions on one row. Below that a second
 * column costs the conversation more than it gives. With the default 320px list
 * and the 26.3% tool share it folds the right side at 1280px wide and keeps
 * three columns at 1440px.
 */
export const DOCK_CENTER_FLOOR = 640

export type DockSideZone = "left" | "right"

export interface DockFoldInput {
  /** Width of the whole dock frame in pixels. */
  frameWidth: number
  /** Minimum centre width. */
  floor: number
  /** Width of one resize separator. */
  separator: number
  /** Resolved pixel widths of each side zone's visible lanes. */
  lanes: Partial<Record<DockSideZone, number[]>>
}

export type DockFold = Record<DockSideZone, boolean>

function zoneWidth(widths: readonly number[], folded: boolean, separator: number): number {
  if (widths.length === 0) return 0
  return (folded ? Math.max(...widths) : widths.reduce((sum, width) => sum + width, 0)) + (folded ? 1 : widths.length) * separator
}

/**
 * Which side zones render their lanes as one stacked column. A zone folds only
 * when its lanes plus the centre floor do not fit beside the other zone; when
 * both sides overflow, the side with more lanes folds first (then the wider
 * saving, then the right). Pure: the saved layout is never changed by folding.
 */
export function computeFold(input: DockFoldInput): DockFold {
  const folded: DockFold = { left: false, right: false }
  const { frameWidth, floor, separator } = input
  if (!(frameWidth > 0)) return folded
  const widths = (zone: DockSideZone) => input.lanes[zone] ?? []
  const total = () => zoneWidth(widths("left"), folded.left, separator) + zoneWidth(widths("right"), folded.right, separator) + floor
  while (total() > frameWidth + 0.5) {
    const candidates = (["right", "left"] as const).filter((zone) => !folded[zone] && widths(zone).length > 1)
    if (candidates.length === 0) break
    const saving = (zone: DockSideZone) => zoneWidth(widths(zone), false, separator) - zoneWidth(widths(zone), true, separator)
    candidates.sort((a, b) => (widths(b).length - widths(a).length) || (saving(b) - saving(a)))
    folded[candidates[0]!] = true
  }
  return folded
}

// --- validation and persistence ---------------------------------------------

function clampIndex(index: number, length: number): number {
  if (!Number.isFinite(index)) return length
  return Math.max(0, Math.min(length, Math.trunc(index)))
}

function isZoneSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= MIN_ZONE_SIZE && value <= MAX_ZONE_SIZE
}

function isGroupSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 100
}

function isId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= MAX_ID_LENGTH
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {}
}

/** Sanitizes one stored group; null when nothing valid is left. Each panel keeps its first placement only. */
function sanitizeGroup(candidate: unknown, seenPanels: Set<string>, seenGroups: Set<string>): DockGroup | null {
  if (!candidate || typeof candidate !== "object") return null
  const group = candidate as Record<string, unknown>
  const panels = Array.isArray(group.panels)
    ? group.panels.filter((id): id is string => isId(id) && !seenPanels.has(id))
    : []
  const unique = [...new Set(panels)]
  if (unique.length === 0) return null
  for (const id of unique) seenPanels.add(id)
  const id = isId(group.id) && !seenGroups.has(group.id) ? group.id : uniqueGroupId(seenGroups, unique[0]!)
  seenGroups.add(id)
  const sanitized: DockGroup = { id, panels: unique }
  if (typeof group.active === "string" && unique.includes(group.active)) sanitized.active = group.active
  if (isGroupSize(group.size)) sanitized.size = group.size
  return sanitized
}

function sanitizeTail(layout: DockLayout, source: Record<string, unknown>, seenPanels: Set<string>) {
  if (Array.isArray(source.collapsed)) {
    layout.collapsed = [...new Set(source.collapsed.filter((id): id is string => isId(id) && seenPanels.has(id)))]
  }
}

/**
 * v1 -> v2: each zone's groups become that zone's one lane and the zone's
 * thickness becomes the lane's size. Nothing is reset; damaged pieces are
 * dropped one by one exactly as v1 loading did. The lane is marked legacy and
 * normalized once its panels' affinities are known (`normalizeLegacyLanes`).
 */
function migrateV1(source: Record<string, unknown>): DockLayout {
  const layout = emptyLayout()
  const seenPanels = new Set<string>()
  const seenGroups = new Set<string>()
  const seenLanes = new Set<string>()
  const zones = asRecord(source.zones)
  const sizes = asRecord(source.zoneSizes)
  for (const zone of DOCK_ZONES) {
    const groups = zones[zone]
    if (!Array.isArray(groups)) continue
    const sanitized = groups
      .map((candidate) => sanitizeGroup(candidate, seenPanels, seenGroups))
      .filter((group): group is DockGroup => group !== null)
    if (sanitized.length === 0) continue
    const lane: DockLane = { id: uniqueLaneId(seenLanes, sanitized[0]!.panels[0]!), groups: sanitized, legacy: true }
    seenLanes.add(lane.id)
    const size = sizes[zone]
    if (isZoneSize(size)) lane.size = Math.round(size)
    layout.zones[zone].push(lane)
  }
  sanitizeTail(layout, source, seenPanels)
  return layout
}

function sanitizeV2(source: Record<string, unknown>): DockLayout {
  const layout = emptyLayout()
  const seenPanels = new Set<string>()
  const seenGroups = new Set<string>()
  const seenLanes = new Set<string>()
  const zones = asRecord(source.zones)
  for (const zone of DOCK_ZONES) {
    const lanes = zones[zone]
    if (!Array.isArray(lanes)) continue
    for (const candidate of lanes) {
      if (!candidate || typeof candidate !== "object") continue
      const lane = candidate as Record<string, unknown>
      const groups = (Array.isArray(lane.groups) ? lane.groups : [])
        .map((group) => sanitizeGroup(group, seenPanels, seenGroups))
        .filter((group): group is DockGroup => group !== null)
      if (groups.length === 0) continue
      const id = isId(lane.id) && !seenLanes.has(lane.id) ? lane.id : uniqueLaneId(seenLanes, groups[0]!.panels[0]!)
      seenLanes.add(id)
      const sanitized: DockLane = { id, groups }
      if (isZoneSize(lane.size)) sanitized.size = Math.round(lane.size)
      if (lane.legacy === true) sanitized.legacy = true
      layout.zones[zone].push(sanitized)
    }
  }
  sanitizeTail(layout, source, seenPanels)
  for (const [id, affinity] of Object.entries(asRecord(source.affinity))) {
    if (seenPanels.has(id) && isDockAffinity(affinity)) layout.affinity[id] = affinity
  }
  return layout
}

/**
 * Tolerant loader. A v1 layout is migrated; anything malformed is dropped piece
 * by piece; an unknown version or a non-object yields the empty (default)
 * layout. Each panel id is kept at its first placement only.
 */
export function sanitizeLayout(raw: unknown): DockLayout {
  if (!raw || typeof raw !== "object") return emptyLayout()
  const source = raw as Record<string, unknown>
  if (source.version === DOCK_LAYOUT_VERSION) return sanitizeV2(source)
  if (source.version === LEGACY_DOCK_LAYOUT_VERSION) return migrateV1(source)
  return emptyLayout()
}

export function parseLayout(json: string | null | undefined): DockLayout {
  if (!json) return emptyLayout()
  try {
    return sanitizeLayout(JSON.parse(json))
  } catch {
    return emptyLayout()
  }
}

export function serializeLayout(layout: DockLayout): string {
  return JSON.stringify(layout)
}

export function dockStorageKey(prefix: string, layoutId: string, version: number = DOCK_LAYOUT_VERSION): string {
  return `${prefix}:${layoutId}:v${version}`
}
