import {
  activatePanel,
  dockStorageKey,
  emptyLayout,
  ensurePanel,
  findPanel,
  moveToZone,
  movePanel,
  parseLayout,
  serializeLayout,
  setCollapsed,
  setGroupSizes,
  setZoneSize,
  visibleLayout,
  DOCK_ZONES,
  type DockLayout,
  type DockTarget,
  type DockZone,
  type VisibleDockLayout,
} from "./layout"
import { captureScroll, resyncScrollListeners, restoreScroll, type ScrollRecord } from "./scroll-memory"

export interface DockPanelMeta {
  title: string
  icon?: string
  defaultZone: DockZone
  order?: number
  minSize?: number
  maxSize?: number
  defaultSize?: number
  collapsible: boolean
  closable: boolean
}

export interface DockSnapshot {
  enabled: boolean
  layoutId: string
  layout: DockLayout
  visible: VisibleDockLayout
  /** Registered panels, in registration order. */
  panels: ReadonlyMap<string, DockPanelMeta>
  /** Panels whose content renders its own primary `PanelHeader`. */
  headers: ReadonlySet<string>
  /** Bumped when a whole layout is (re)loaded, so zones re-apply stored sizes. */
  generation: number
}

export interface DockRect {
  left: number
  top: number
  width: number
  height: number
}

export interface DockDropCandidate {
  target: DockTarget
  hit: DockRect
  preview: DockRect
  label: string
}

export interface DockDragState {
  panelId: string
  title: string
  icon?: string
  x: number
  y: number
  candidates: DockDropCandidate[]
  active: DockDropCandidate | null
}

export interface DockConfig {
  layoutId: string
  storagePrefix: string | null
  enabled: boolean
}

interface Registration {
  token: object
  meta: DockPanelMeta
  onClose?: () => void
}

interface HeaderRegistration {
  token: object
  element: HTMLElement
}

const ZONE_EDGE = 44
const GROUP_EDGE_RATIO = 0.28
const FALLBACK_ZONE_SIZE: Record<DockZone, number> = { left: 320, right: 360, bottom: 260 }

export class DockStore {
  readonly ownerDocument: Document
  private listeners = new Set<() => void>()
  private dragListeners = new Set<() => void>()
  private registrations = new Map<string, Registration>()
  private hosts = new Map<string, HTMLDivElement>()
  private headerRegistrations = new Map<string, HeaderRegistration[]>()
  private layout: DockLayout = emptyLayout()
  private config: DockConfig
  private generation = 0
  /** Storage key the in-memory layout came from; null until docking is first enabled. */
  private loadedKey: string | null = null
  private snapshot: DockSnapshot
  private drag: DockDragState | null = null
  private frame: HTMLElement | null = null
  private pendingScroll: ScrollRecord[] | null = null
  private pendingFocus: HTMLElement | null = null

  constructor(ownerDocument: Document, config: DockConfig) {
    this.ownerDocument = ownerDocument
    this.config = config
    // Below the desktop breakpoints the dock is inert: nothing is read until it is enabled.
    if (config.enabled) this.load()
    this.snapshot = this.buildSnapshot()
  }

  // --- subscription ------------------------------------------------------

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = () => this.snapshot

  isEnabled = () => this.config.enabled

  subscribeDrag = (listener: () => void) => {
    this.dragListeners.add(listener)
    return () => { this.dragListeners.delete(listener) }
  }

  getDrag = () => this.drag

  private emit() {
    this.snapshot = this.buildSnapshot()
    for (const listener of [...this.listeners]) listener()
  }

  private emitDrag() {
    for (const listener of [...this.dragListeners]) listener()
  }

  private buildSnapshot(): DockSnapshot {
    const panels = new Map<string, DockPanelMeta>()
    for (const [id, registration] of this.registrations) panels.set(id, registration.meta)
    const headers = new Set<string>()
    for (const id of this.headerRegistrations.keys()) {
      if (this.primaryHeaderToken(id)) headers.add(id)
    }
    return {
      enabled: this.config.enabled,
      layoutId: this.config.layoutId,
      layout: this.layout,
      visible: visibleLayout(this.layout, (id) => this.registrations.has(id)),
      panels,
      headers,
      generation: this.generation,
    }
  }

  // --- configuration and persistence -------------------------------------

  configure(next: DockConfig) {
    const previous = this.config
    if (previous.layoutId === next.layoutId && previous.storagePrefix === next.storagePrefix
      && previous.enabled === next.enabled) return
    this.cancelDrag()
    this.config = next
    if (next.enabled) {
      if (this.loadedKey !== this.layoutKeyId()) {
        this.captureMoveState()
        this.load()
      } else {
        this.layout = this.withRegisteredPanels(this.layout)
      }
    }
    this.emit()
  }

  private storageKey(): string | null {
    const { storagePrefix, layoutId } = this.config
    return storagePrefix && layoutId ? dockStorageKey(storagePrefix, layoutId) : null
  }

  private storage(): Storage | null {
    try {
      return this.ownerDocument.defaultView?.localStorage ?? null
    } catch {
      return null
    }
  }

  private layoutKeyId(): string {
    return this.storageKey() ?? `memory:${this.config.layoutId}`
  }

  /** Replaces the in-memory layout with the stored one for the current layout id. */
  private load() {
    const key = this.storageKey()
    let layout = emptyLayout()
    if (key) {
      try {
        layout = parseLayout(this.storage()?.getItem(key))
      } catch {
        layout = emptyLayout()
      }
    }
    this.layout = this.withRegisteredPanels(layout)
    this.loadedKey = this.layoutKeyId()
    this.generation += 1
  }

  private persist() {
    const key = this.storageKey()
    if (!key) return
    try {
      this.storage()?.setItem(key, serializeLayout(this.layout))
    } catch {
      // Storage full or blocked: the layout still applies for this session.
    }
  }

  private withRegisteredPanels(layout: DockLayout): DockLayout {
    let next = layout
    for (const [id, registration] of this.registrations) {
      next = this.ensure(next, id, registration.meta)
    }
    return next
  }

  private ensure(layout: DockLayout, id: string, meta: DockPanelMeta): DockLayout {
    return ensurePanel(
      layout,
      id,
      { zone: meta.defaultZone, order: meta.order, size: meta.defaultSize },
      (panelId) => this.registrations.get(panelId)?.meta.order,
    )
  }

  // --- registration -------------------------------------------------------

  hostElement(id: string): HTMLDivElement {
    let host = this.hosts.get(id)
    if (!host) {
      host = this.ownerDocument.createElement("div")
      host.dataset.dockPanel = id
      host.id = `dock-panel-${id.replace(/[^A-Za-z0-9_-]/g, "_")}`
      host.style.cssText = "position:absolute;inset:0;display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden"
      this.hosts.set(id, host)
    }
    return host
  }

  /** Claims a panel id. Returns false when another live owner already holds it. */
  claim(id: string, token: object, meta: DockPanelMeta, onClose?: () => void): boolean {
    const existing = this.registrations.get(id)
    if (existing && existing.token !== token) return false
    this.registrations.set(id, { token, meta, onClose })
    if (this.config.enabled) {
      const next = this.ensure(this.layout, id, meta)
      if (next !== this.layout) {
        this.layout = next
        this.persist()
      }
    }
    this.emit()
    return true
  }

  release(id: string, token: object) {
    const existing = this.registrations.get(id)
    if (!existing || existing.token !== token) return
    this.registrations.delete(id)
    if (this.drag?.panelId === id) this.cancelDrag()
    this.emit()
  }

  update(id: string, token: object, meta: DockPanelMeta, onClose?: () => void) {
    const existing = this.registrations.get(id)
    if (!existing || existing.token !== token) return
    existing.onClose = onClose
    if (sameMeta(existing.meta, meta)) return
    existing.meta = meta
    this.emit()
  }

  close(id: string) {
    this.registrations.get(id)?.onClose?.()
  }

  // --- headers ------------------------------------------------------------

  registerHeader(panelId: string, token: object, element: HTMLElement) {
    const list = this.headerRegistrations.get(panelId) ?? []
    if (list.some((entry) => entry.token === token)) return
    const before = this.primaryHeaderToken(panelId)
    this.headerRegistrations.set(panelId, [...list, { token, element }])
    if (this.primaryHeaderToken(panelId) !== before) this.emit()
  }

  unregisterHeader(panelId: string, token: object) {
    const list = this.headerRegistrations.get(panelId)
    if (!list) return
    const before = this.primaryHeaderToken(panelId)
    const next = list.filter((entry) => entry.token !== token)
    if (next.length) this.headerRegistrations.set(panelId, next)
    else this.headerRegistrations.delete(panelId)
    if (this.primaryHeaderToken(panelId) !== before) this.emit()
  }

  /** The first registered header that actually sits inside the panel (not in a dialog portal). */
  private primaryHeaderToken(panelId: string): object | null {
    const host = this.hosts.get(panelId)
    const list = this.headerRegistrations.get(panelId)
    if (!host || !list) return null
    return list.find((entry) => host.contains(entry.element))?.token ?? null
  }

  isPrimaryHeader(panelId: string, token: object): boolean {
    return this.primaryHeaderToken(panelId) === token
  }

  // --- layout actions -----------------------------------------------------

  private apply(next: DockLayout, structural: boolean) {
    if (!this.config.enabled || next === this.layout) return
    if (structural) this.captureMoveState()
    this.layout = next
    this.persist()
    this.emit()
  }

  move(panelId: string, target: DockTarget) {
    this.apply(movePanel(this.layout, panelId, target), true)
  }

  moveToZone(panelId: string, zone: DockZone) {
    this.apply(moveToZone(this.layout, panelId, zone), true)
  }

  activate(panelId: string) {
    this.apply(activatePanel(this.layout, panelId), false)
  }

  setCollapsed(panelId: string, collapsed: boolean) {
    this.apply(setCollapsed(this.layout, panelId, collapsed), true)
  }

  setZoneSize(zone: DockZone, size: number) {
    this.apply(setZoneSize(this.layout, zone, size), false)
  }

  setGroupSizes(zone: DockZone, sizes: Record<string, number>) {
    this.apply(setGroupSizes(this.layout, zone, sizes), false)
  }

  reset() {
    if (!this.config.enabled) return
    this.captureMoveState()
    const key = this.storageKey()
    if (key) {
      try { this.storage()?.removeItem(key) } catch { /* ignore */ }
    }
    this.layout = this.withRegisteredPanels(emptyLayout())
    this.generation += 1
    this.persist()
    this.emit()
  }

  zoneOf(panelId: string): DockZone | null {
    return findPanel(this.layout, panelId)?.zone ?? null
  }

  // --- re-parenting -------------------------------------------------------

  /** Moves a panel's host element into a group body. React content inside is untouched. */
  attach(panelId: string, container: HTMLElement) {
    const host = this.hostElement(panelId)
    if (host.parentElement !== container) container.appendChild(host)
  }

  park(container: HTMLElement) {
    for (const [id, host] of this.hosts) {
      if (!this.registrations.has(id)) continue
      if (host.parentElement?.hasAttribute("data-dock-group-body")) continue
      if (host.parentElement !== container) container.appendChild(host)
    }
  }

  /**
   * Detaching a DOM node resets the scroll offsets inside it and drops focus.
   * Record both before any change that can re-parent a host element.
   */
  private captureMoveState() {
    const records: ScrollRecord[] = this.pendingScroll ?? []
    for (const host of this.hosts.values()) {
      if (host.isConnected) captureScroll(host, records)
    }
    this.pendingScroll = records
    const active = this.ownerDocument.activeElement
    if (active instanceof HTMLElement && [...this.hosts.values()].some((host) => host !== active && host.contains(active))) {
      this.pendingFocus = active
    }
  }

  /** Runs after every frame commit, once host elements are back in place. */
  restoreMoveState() {
    const records = this.pendingScroll
    const focus = this.pendingFocus
    this.pendingScroll = null
    this.pendingFocus = null
    if (records) {
      restoreScroll(records)
      for (const host of this.hosts.values()) resyncScrollListeners(host)
    }
    if (focus && focus.isConnected) {
      const active = this.ownerDocument.activeElement
      if (!active || active === this.ownerDocument.body) focus.focus({ preventScroll: true })
    }
  }

  // --- drag ---------------------------------------------------------------

  setFrame(frame: HTMLElement | null) {
    this.frame = frame
  }

  startDrag(panelId: string, x: number, y: number) {
    const meta = this.registrations.get(panelId)?.meta
    if (!meta || !this.config.enabled) return false
    const candidates = this.dropCandidates(panelId)
    this.drag = { panelId, title: meta.title, icon: meta.icon, x, y, candidates, active: hitTest(candidates, x, y) }
    this.emitDrag()
    return true
  }

  updateDrag(x: number, y: number) {
    if (!this.drag) return
    this.drag = { ...this.drag, x, y, active: hitTest(this.drag.candidates, x, y) }
    this.emitDrag()
  }

  drop() {
    const drag = this.drag
    this.drag = null
    this.emitDrag()
    if (drag?.active) this.move(drag.panelId, drag.active.target)
  }

  cancelDrag() {
    if (!this.drag) return
    this.drag = null
    this.emitDrag()
  }

  private dropCandidates(panelId: string): DockDropCandidate[] {
    const frame = this.frame
    if (!frame) return []
    const candidates: DockDropCandidate[] = []
    const visible = this.snapshot.visible

    for (const element of frame.querySelectorAll<HTMLElement>("[data-dock-group]")) {
      const groupId = element.dataset.dockGroup!
      const zone = element.dataset.dockGroupZone as DockZone
      const group = visible.zones[zone]?.find((candidate) => candidate.id === groupId)
      if (!group) continue
      const rect = toRect(element.getBoundingClientRect())
      const title = (id: string) => this.registrations.get(id)?.meta.title ?? id
      const groupLabel = group.panels.map(title).join(", ")
      const soleSelf = group.panels.length === 1 && group.panels[0] === panelId
      if (soleSelf) continue
      const horizontal = zone === "bottom"
      const edge = (horizontal ? rect.width : rect.height) * GROUP_EDGE_RATIO
      const before: DockRect = horizontal
        ? { ...rect, width: edge }
        : { ...rect, height: edge }
      const after: DockRect = horizontal
        ? { ...rect, left: rect.left + rect.width - edge, width: edge }
        : { ...rect, top: rect.top + rect.height - edge, height: edge }
      const middle: DockRect = horizontal
        ? { ...rect, left: rect.left + edge, width: rect.width - 2 * edge }
        : { ...rect, top: rect.top + edge, height: rect.height - 2 * edge }
      const half = (side: "before" | "after"): DockRect => horizontal
        ? { ...rect, width: rect.width / 2, left: side === "before" ? rect.left : rect.left + rect.width / 2 }
        : { ...rect, height: rect.height / 2, top: side === "before" ? rect.top : rect.top + rect.height / 2 }
      candidates.push({
        target: { kind: "split", groupId, side: "before" },
        hit: before,
        preview: half("before"),
        label: `Split ${horizontal ? "left of" : "above"} ${groupLabel}`,
      })
      candidates.push({
        target: { kind: "split", groupId, side: "after" },
        hit: after,
        preview: half("after"),
        label: `Split ${horizontal ? "right of" : "below"} ${groupLabel}`,
      })
      candidates.push({ target: { kind: "tab", groupId }, hit: middle, preview: rect, label: `Tab with ${groupLabel}` })
    }

    const column = frame.querySelector<HTMLElement>("[data-dock-column]")
    const center = frame.querySelector<HTMLElement>("[data-dock-center]")
    if (column && center) {
      const columnRect = toRect(column.getBoundingClientRect())
      const centerRect = toRect(center.getBoundingClientRect())
      for (const zone of DOCK_ZONES) {
        if (visible.zones[zone].length > 0 || visible.collapsed[zone].length > 0) continue
        const size = this.layout.zoneSizes[zone] ?? this.registrations.get(panelId)?.meta.defaultSize ?? FALLBACK_ZONE_SIZE[zone]
        if (zone === "bottom") {
          const height = Math.min(size, centerRect.height * 0.5)
          candidates.push({
            target: { kind: "zone", zone },
            hit: { ...centerRect, top: centerRect.top + centerRect.height - ZONE_EDGE, height: ZONE_EDGE },
            preview: { ...centerRect, top: centerRect.top + centerRect.height - height, height },
            label: "Dock at the bottom",
          })
        } else {
          const width = Math.min(size, columnRect.width * 0.45)
          candidates.push({
            target: { kind: "zone", zone },
            hit: zone === "left"
              ? { ...columnRect, width: ZONE_EDGE }
              : { ...columnRect, left: columnRect.left + columnRect.width - ZONE_EDGE, width: ZONE_EDGE },
            preview: zone === "left"
              ? { ...columnRect, width }
              : { ...columnRect, left: columnRect.left + columnRect.width - width, width },
            label: zone === "left" ? "Dock on the left" : "Dock on the right",
          })
        }
      }
    }
    // Zone edges win over the group regions they may overlap.
    return candidates.sort((a, b) => Number(b.target.kind === "zone") - Number(a.target.kind === "zone"))
  }
}

function toRect(rect: DOMRect): DockRect {
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
}

function contains(rect: DockRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.left + rect.width && y >= rect.top && y <= rect.top + rect.height
}

function hitTest(candidates: DockDropCandidate[], x: number, y: number): DockDropCandidate | null {
  return candidates.find((candidate) => contains(candidate.hit, x, y)) ?? null
}

function sameMeta(a: DockPanelMeta, b: DockPanelMeta): boolean {
  return a.title === b.title && a.icon === b.icon && a.defaultZone === b.defaultZone && a.order === b.order
    && a.minSize === b.minSize && a.maxSize === b.maxSize && a.defaultSize === b.defaultSize
    && a.collapsible === b.collapsible && a.closable === b.closable
}

export const DOCK_DEFAULT_ZONE_SIZE = FALLBACK_ZONE_SIZE
