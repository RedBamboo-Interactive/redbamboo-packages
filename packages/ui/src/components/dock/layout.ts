// Pure dock layout model. No React, no DOM: everything here is unit-tested.
//
// A layout places panel ids into three zones around a fixed centre. Each zone
// holds groups split along its cross axis (left/right stack vertically, bottom
// stacks horizontally); each group is a tab stack. The model remembers panels
// that are not currently registered (a closed Console keeps its placement), and
// `visibleLayout` filters down to what is actually rendered.

export type DockZone = "left" | "right" | "bottom"

export const DOCK_ZONES: readonly DockZone[] = ["left", "right", "bottom"]

export const DOCK_LAYOUT_VERSION = 1

export interface DockGroup {
  id: string
  panels: string[]
  active?: string
  /** Share of the zone along its stacking axis, in percent. */
  size?: number
}

export interface DockLayout {
  version: typeof DOCK_LAYOUT_VERSION
  zones: Record<DockZone, DockGroup[]>
  /** Zone thickness in pixels (width for left/right, height for bottom). */
  zoneSizes: Partial<Record<DockZone, number>>
  collapsed: string[]
}

export type DockTarget =
  | { kind: "zone"; zone: DockZone }
  | { kind: "tab"; groupId: string; index?: number }
  | { kind: "split"; groupId: string; side: "before" | "after" }

export interface DockPanelPlacementDefaults {
  zone: DockZone
  order?: number
  size?: number
}

export interface VisibleDockGroup {
  id: string
  zone: DockZone
  panels: string[]
  active: string
  size?: number
}

export interface VisibleDockLayout {
  zones: Record<DockZone, VisibleDockGroup[]>
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
    zoneSizes: {},
    collapsed: [],
  }
}

export function isDockZone(value: unknown): value is DockZone {
  return value === "left" || value === "right" || value === "bottom"
}

function cloneLayout(layout: DockLayout): DockLayout {
  return {
    version: DOCK_LAYOUT_VERSION,
    zones: {
      left: layout.zones.left.map(cloneGroup),
      right: layout.zones.right.map(cloneGroup),
      bottom: layout.zones.bottom.map(cloneGroup),
    },
    zoneSizes: { ...layout.zoneSizes },
    collapsed: [...layout.collapsed],
  }
}

function cloneGroup(group: DockGroup): DockGroup {
  return { ...group, panels: [...group.panels] }
}

export interface PanelLocation {
  zone: DockZone
  groupIndex: number
  group: DockGroup
  index: number
}

export function findPanel(layout: DockLayout, panelId: string): PanelLocation | null {
  for (const zone of DOCK_ZONES) {
    const groups = layout.zones[zone]
    for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
      const group = groups[groupIndex]!
      const index = group.panels.indexOf(panelId)
      if (index >= 0) return { zone, groupIndex, group, index }
    }
  }
  return null
}

export function findGroup(layout: DockLayout, groupId: string): { zone: DockZone; index: number; group: DockGroup } | null {
  for (const zone of DOCK_ZONES) {
    const index = layout.zones[zone].findIndex((group) => group.id === groupId)
    if (index >= 0) return { zone, index, group: layout.zones[zone][index]! }
  }
  return null
}

function allGroupIds(layout: DockLayout): Set<string> {
  const ids = new Set<string>()
  for (const zone of DOCK_ZONES) for (const group of layout.zones[zone]) ids.add(group.id)
  return ids
}

/** Deterministic group id derived from the panel that founds the group. */
export function uniqueGroupId(taken: ReadonlySet<string>, panelId: string): string {
  const base = `g:${panelId}`
  if (!taken.has(base)) return base
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}:${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Removes a panel from wherever it is placed, pruning a group it leaves empty. Mutates `draft`. */
function detach(draft: DockLayout, panelId: string): void {
  const location = findPanel(draft, panelId)
  if (!location) return
  const { zone, groupIndex, group, index } = location
  group.panels.splice(index, 1)
  if (group.panels.length === 0) {
    draft.zones[zone].splice(groupIndex, 1)
    return
  }
  if (group.active === panelId) {
    group.active = group.panels[Math.min(index, group.panels.length - 1)]
  }
}

/** Forgets a panel's placement entirely. */
export function removePanel(layout: DockLayout, panelId: string): DockLayout {
  if (!findPanel(layout, panelId) && !layout.collapsed.includes(panelId)) return layout
  const draft = cloneLayout(layout)
  detach(draft, panelId)
  draft.collapsed = draft.collapsed.filter((id) => id !== panelId)
  return draft
}

export function movePanel(layout: DockLayout, panelId: string, target: DockTarget): DockLayout {
  const source = findPanel(layout, panelId)

  if (target.kind === "tab") {
    const destination = findGroup(layout, target.groupId)
    if (!destination) return layout
    const draft = cloneLayout(layout)
    draft.collapsed = draft.collapsed.filter((id) => id !== panelId)
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
    draft.collapsed = draft.collapsed.filter((id) => id !== panelId)
    detach(draft, panelId)
    const anchor = findGroup(draft, target.groupId)
    if (!anchor) return layout
    const id = uniqueGroupId(allGroupIds(draft), panelId)
    const created: DockGroup = { id, panels: [panelId], active: panelId }
    if (anchor.group.size !== undefined) {
      const half = anchor.group.size / 2
      anchor.group.size = half
      created.size = half
    }
    draft.zones[anchor.zone].splice(target.side === "before" ? anchor.index : anchor.index + 1, 0, created)
    return draft
  }

  // New group at the end of the zone.
  const draft = cloneLayout(layout)
  draft.collapsed = draft.collapsed.filter((id) => id !== panelId)
  if (source && source.zone === target.zone && source.group.panels.length === 1
    && source.groupIndex === layout.zones[target.zone].length - 1) {
    return draft.collapsed.length === layout.collapsed.length ? layout : draft
  }
  detach(draft, panelId)
  const id = uniqueGroupId(allGroupIds(draft), panelId)
  draft.zones[target.zone].push({ id, panels: [panelId], active: panelId })
  return draft
}

/** Keyboard/palette move: no-op when the panel already lives in that zone. */
export function moveToZone(layout: DockLayout, panelId: string, zone: DockZone): DockLayout {
  const source = findPanel(layout, panelId)
  if (source?.zone === zone) return layout
  return movePanel(layout, panelId, { kind: "zone", zone })
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
 * know it yet. A new group is inserted before the first group whose panels
 * have a higher `order`, so default stacking follows the declared order.
 */
export function ensurePanel(
  layout: DockLayout,
  panelId: string,
  defaults: DockPanelPlacementDefaults,
  orderOf: (panelId: string) => number | undefined = () => undefined,
): DockLayout {
  if (findPanel(layout, panelId)) return layout
  const draft = cloneLayout(layout)
  const groups = draft.zones[defaults.zone]
  const group: DockGroup = { id: uniqueGroupId(allGroupIds(draft), panelId), panels: [panelId], active: panelId }
  let index = groups.length
  if (defaults.order !== undefined) {
    const found = groups.findIndex((candidate) => candidate.panels.some((id) => {
      const order = orderOf(id)
      return order !== undefined && order > defaults.order!
    }))
    if (found >= 0) index = found
  }
  groups.splice(index, 0, group)
  if (draft.zoneSizes[defaults.zone] === undefined && isZoneSize(defaults.size)) {
    draft.zoneSizes[defaults.zone] = Math.round(defaults.size)
  }
  return draft
}

export function setZoneSize(layout: DockLayout, zone: DockZone, size: number): DockLayout {
  if (!isZoneSize(size)) return layout
  const rounded = Math.round(size)
  if (layout.zoneSizes[zone] === rounded) return layout
  const draft = cloneLayout(layout)
  draft.zoneSizes[zone] = rounded
  return draft
}

export function setGroupSizes(layout: DockLayout, zone: DockZone, sizes: Record<string, number>): DockLayout {
  let changed = false
  const draft = cloneLayout(layout)
  for (const group of draft.zones[zone]) {
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
  const zones = { left: [], right: [], bottom: [] } as Record<DockZone, VisibleDockGroup[]>
  const collapsed = { left: [], right: [], bottom: [] } as Record<DockZone, string[]>
  for (const zone of DOCK_ZONES) {
    for (const group of layout.zones[zone]) {
      const panels: string[] = []
      for (const id of group.panels) {
        if (!isRegistered(id)) continue
        if (collapsedSet.has(id)) collapsed[zone].push(id)
        else panels.push(id)
      }
      if (panels.length === 0) continue
      const active = group.active !== undefined && panels.includes(group.active) ? group.active : panels[0]!
      zones[zone].push({ id: group.id, zone, panels, active, size: group.size })
    }
  }
  return { zones, collapsed }
}

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

/**
 * Tolerant loader. Anything malformed is dropped piece by piece; a wrong
 * version or a non-object yields the empty (default) layout. Each panel id is
 * kept at its first placement only.
 */
export function sanitizeLayout(raw: unknown): DockLayout {
  const layout = emptyLayout()
  if (!raw || typeof raw !== "object") return layout
  const source = raw as Record<string, unknown>
  if (source.version !== DOCK_LAYOUT_VERSION) return layout

  const seenPanels = new Set<string>()
  const seenGroups = new Set<string>()
  const zones = source.zones && typeof source.zones === "object" ? source.zones as Record<string, unknown> : {}
  for (const zone of DOCK_ZONES) {
    const groups = zones[zone]
    if (!Array.isArray(groups)) continue
    for (const candidate of groups) {
      if (!candidate || typeof candidate !== "object") continue
      const group = candidate as Record<string, unknown>
      const panels = Array.isArray(group.panels)
        ? group.panels.filter((id): id is string => isId(id) && !seenPanels.has(id))
        : []
      const unique = [...new Set(panels)]
      if (unique.length === 0) continue
      for (const id of unique) seenPanels.add(id)
      const id = isId(group.id) && !seenGroups.has(group.id) ? group.id : uniqueGroupId(seenGroups, unique[0]!)
      seenGroups.add(id)
      const sanitized: DockGroup = { id, panels: unique }
      if (typeof group.active === "string" && unique.includes(group.active)) sanitized.active = group.active
      if (isGroupSize(group.size)) sanitized.size = group.size
      layout.zones[zone].push(sanitized)
    }
  }

  const sizes = source.zoneSizes && typeof source.zoneSizes === "object" ? source.zoneSizes as Record<string, unknown> : {}
  for (const zone of DOCK_ZONES) {
    const size = sizes[zone]
    if (isZoneSize(size)) layout.zoneSizes[zone] = Math.round(size)
  }

  if (Array.isArray(source.collapsed)) {
    layout.collapsed = [...new Set(source.collapsed.filter((id): id is string => isId(id) && seenPanels.has(id)))]
  }
  return layout
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

export function dockStorageKey(prefix: string, layoutId: string): string {
  return `${prefix}:${layoutId}:v${DOCK_LAYOUT_VERSION}`
}
