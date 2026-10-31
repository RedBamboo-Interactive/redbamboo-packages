// The dock panel menu as item descriptors: the grip's menu and a right-click
// on a panel's tab or header show the same array. Import-free for node tests;
// the shape matches `ContextMenuEntry`.

export type DockMenuZone = "left" | "right" | "bottom"

export interface DockPanelActionState {
  /** Zones in menu order. */
  zones: readonly DockMenuZone[]
  /** The panel's current zone, or null when it is not placed. */
  zone: DockMenuZone | null
  canMoveToOwnLane: boolean
  collapsible: boolean
  closable: boolean
}

export interface DockPanelActionHandlers {
  moveToZone: (zone: DockMenuZone) => void
  moveToOwnLane: () => void
  collapse: () => void
  close: () => void
}

export type DockPanelEntry =
  | { id: string; label: string; icon: string; disabled?: boolean; run: () => void }
  | { id: string; separator: true }

const ZONE_ICON: Record<DockMenuZone, string> = {
  left: "ph-arrow-line-left",
  right: "ph-arrow-line-right",
  bottom: "ph-arrow-line-down",
}

/** Move to each zone (the current one disabled), own column, Collapse, Close. */
export function dockPanelEntries(state: DockPanelActionState, handlers: DockPanelActionHandlers): DockPanelEntry[] {
  const entries: DockPanelEntry[] = state.zones.map((target) => ({
    id: `dock-move-${target}`,
    label: `Move to ${target}`,
    icon: `ph-bold ${ZONE_ICON[target]}`,
    disabled: target === state.zone,
    run: () => handlers.moveToZone(target),
  }))
  if (state.zone !== "bottom") {
    entries.push({ id: "dock-own-column", label: "Move to own column", icon: "ph-bold ph-columns", disabled: !state.canMoveToOwnLane, run: () => handlers.moveToOwnLane() })
  }
  if (state.collapsible) {
    entries.push(
      { id: "dock-collapse-separator", separator: true },
      { id: "dock-collapse", label: "Collapse", icon: "ph-bold ph-arrows-in-line-horizontal", run: () => handlers.collapse() },
    )
  }
  if (state.closable) {
    entries.push(
      { id: "dock-close-separator", separator: true },
      { id: "dock-close", label: "Close", icon: "ph-bold ph-x", run: () => handlers.close() },
    )
  }
  return entries
}
