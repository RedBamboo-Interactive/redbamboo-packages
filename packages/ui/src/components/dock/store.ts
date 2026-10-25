import {
  activatePanel,
  canMoveToOwnLane,
  dockStorageKey,
  emptyLayout,
  ensurePanel,
  findPanel,
  moveToOwnLane,
  moveToZone,
  movePanel,
  parseLayout,
  serializeLayout,
  setCollapsed,
  setGroupSizes,
  setLaneSizes,
  visibleLayout,
  DOCK_ZONES,
  LEGACY_DOCK_LAYOUT_VERSION,
  type DockAffinity,
  type DockFold,
  type DockLayout,
  type DockTarget,
  type DockZone,
  type VisibleDockLane,
  type VisibleDockLayout,
} from "./layout"
import { captureScroll, resyncScrollListeners, restoreScroll, type ScrollRecord } from "./scroll-memory"

/** A zone thickness: pixels, or a share of the dock frame such as "26.3%". */
export type DockSize = number | `${number}%`

/** What a docked panel paints behind its header row and body, as one surface. */
export type DockSurface = "elevated" | "none"

export interface DockPanelMeta {
  title: string
  icon?: string
  defaultZone: DockZone
  order?: number
  minSize?: number
  maxSize?: number
  defaultSize?: DockSize
  surface: DockSurface
  affinity: DockAffinity
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
  /** The primary header's own classes, which the group header row takes on. */
  headerClasses: ReadonlyMap<string, string>
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
  /** The header's in-place container inside the panel. */
  element: HTMLElement
  /** Stable element holding the header's content; the dock re-parents it into the group header row. */
  contentHost: HTMLElement
  className: string
}

const ZONE_EDGE = 44
const GROUP_EDGE_RATIO = 0.28
/** Width of a group's inner/outer "new column" strip: a share of the group, capped. */
const LANE_EDGE_RATIO = 0.2
const LANE_EDGE_MAX = 56
const FALLBACK_ZONE_SIZE: Record<DockZone, number> = { left: 320, right: 360, bottom: 260 }

/** A host no group shows: never painted, never hit, never focusable. Its group restores it on attach. */
function hideHost(host: HTMLElement) {
  host.style.visibility = "hidden"
  host.inert = true
  host.setAttribute("aria-hidden", "true")
}

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
  /** The frame's hidden parking element, where hosts wait while no group shows them. */
  private parking: HTMLElement | null = null
  private pendingScroll: ScrollRecord[] | null = null
  private pendingFocus: HTMLElement | null = null
  /** Side zones the frame currently renders as one stacked column (render-time only). */
  private fold: DockFold = { left: false, right: false }

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
    const headerClasses = new Map<string, string>()
    for (const [id, list] of this.headerRegistrations) {
      const token = this.primaryHeaderToken(id)
      if (!token) continue
      headers.add(id)
      const primary = list.find((entry) => entry.token === token)
      if (primary) headerClasses.set(id, primary.className)
    }
    return {
      enabled: this.config.enabled,
      layoutId: this.config.layoutId,
      layout: this.layout,
      visible: visibleLayout(this.layout, (id) => this.registrations.has(id)),
      panels,
      headers,
      headerClasses,
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

  /** The previous format's key; read once to migrate a layout saved before lanes existed. */
  private legacyStorageKey(): string | null {
    const { storagePrefix, layoutId } = this.config
    return storagePrefix && layoutId ? dockStorageKey(storagePrefix, layoutId, LEGACY_DOCK_LAYOUT_VERSION) : null
  }

  /** Replaces the in-memory layout with the stored one for the current layout id. */
  private load() {
    const key = this.storageKey()
    let layout = emptyLayout()
    let migrated = false
    if (key) {
      try {
        const storage = this.storage()
        const stored = storage?.getItem(key) ?? null
        if (stored !== null) {
          layout = parseLayout(stored)
        } else {
          // Never reset a saved layout: a v1 layout becomes v2 (its key is left for older builds).
          const legacyKey = this.legacyStorageKey()
          const legacy = legacyKey ? storage?.getItem(legacyKey) ?? null : null
          if (legacy !== null) {
            layout = parseLayout(legacy)
            migrated = true
          }
        }
      } catch {
        layout = emptyLayout()
      }
    }
    this.layout = this.withRegisteredPanels(layout)
    this.loadedKey = this.layoutKeyId()
    this.generation += 1
    if (migrated) this.persist()
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
      // Only pixel sizes are stored; a share of the frame stays proportional until resized.
      { zone: meta.defaultZone, order: meta.order, size: typeof meta.defaultSize === "number" ? meta.defaultSize : undefined, affinity: meta.affinity },
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
      // A panel appearing can move others: lanes shift outward, a side may fold.
      this.captureMoveState()
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
    if (this.config.enabled) this.captureMoveState()
    this.stow(id)
    this.emit()
  }

  /**
   * Takes a released panel's host out of its group body at once. Its content is
   * unmounting, and an empty host left there (absolute, inset 0) would cover the
   * panels beneath it and take their clicks. The host itself is kept: a reopen
   * renders into it again and its group re-attaches it.
   */
  private stow(id: string) {
    const host = this.hosts.get(id)
    if (!host) return
    hideHost(host)
    if (this.parking?.isConnected) {
      if (host.parentElement !== this.parking) this.parking.appendChild(host)
    } else {
      host.remove()
    }
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

  registerHeader(panelId: string, token: object, element: HTMLElement, contentHost: HTMLElement, className: string) {
    const list = this.headerRegistrations.get(panelId) ?? []
    if (list.some((entry) => entry.token === token)) return
    const before = this.primaryHeaderToken(panelId)
    this.headerRegistrations.set(panelId, [...list, { token, element, contentHost, className }])
    if (this.primaryHeaderToken(panelId) !== before) this.emit()
  }

  setHeaderClass(panelId: string, token: object, className: string) {
    const entry = this.headerRegistrations.get(panelId)?.find((candidate) => candidate.token === token)
    if (!entry || entry.className === className) return
    entry.className = className
    if (this.primaryHeaderToken(panelId) === token) this.emit()
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

  /** Content host of the panel's primary header, which the group header row displays. */
  headerHost(panelId: string): HTMLElement | null {
    const token = this.primaryHeaderToken(panelId)
    return this.headerRegistrations.get(panelId)?.find((entry) => entry.token === token)?.contentHost ?? null
  }

  /** How the group header row shows this panel: its whole header alone, or only its actions beside tabs. */
  headerMode(panelId: string): "single" | "tab" | null {
    for (const zone of DOCK_ZONES) {
      for (const lane of this.snapshot.visible.zones[zone]) {
        const group = lane.groups.find((candidate) => candidate.panels.includes(panelId))
        if (group) return group.panels.length > 1 ? "tab" : "single"
      }
    }
    return null
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

  /** Shown panels: registered and not collapsed. Closed panels keep a placement but take no room. */
  private isShown = (panelId: string) => this.registrations.has(panelId) && !this.layout.collapsed.includes(panelId)

  canMoveToOwnLane(panelId: string): boolean {
    return canMoveToOwnLane(this.layout, panelId, this.isShown)
  }

  moveToOwnLane(panelId: string) {
    this.apply(moveToOwnLane(this.layout, panelId, this.isShown), true)
  }

  activate(panelId: string) {
    this.apply(activatePanel(this.layout, panelId), false)
  }

  setCollapsed(panelId: string, collapsed: boolean) {
    this.apply(setCollapsed(this.layout, panelId, collapsed), true)
  }

  setLaneSizes(sizes: Record<string, number>) {
    this.apply(setLaneSizes(this.layout, sizes), false)
  }

  setGroupSizes(laneId: string, sizes: Record<string, number>) {
    this.apply(setGroupSizes(this.layout, laneId, sizes), false)
  }

  reset() {
    if (!this.config.enabled) return
    this.captureMoveState()
    for (const key of [this.storageKey(), this.legacyStorageKey()]) {
      if (!key) continue
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

  /**
   * Moves a panel's host element into a group body. React content inside is untouched.
   * Returns false for a panel that is not registered: a group rendered from a
   * snapshot older than its release must not pull the emptied host back in.
   */
  attach(panelId: string, container: HTMLElement): boolean {
    if (!this.registrations.has(panelId)) return false
    const host = this.hostElement(panelId)
    if (host.parentElement !== container) container.appendChild(host)
    return true
  }

  /**
   * Runs after every frame commit, once groups have attached their panels. A host
   * inside a group body that the group does not show (a collapsed tab, or a panel
   * released while a stale group re-attached it) is hidden and made inert: the
   * group keeps all but its active panel that way too, so only the active panel
   * of a group can ever take a pointer event. A released host also goes to the
   * hidden parking element; a registered one stays put to keep its scroll.
   */
  park(container: HTMLElement) {
    this.parking = container
    const shownIn = new Map<string, string>()
    for (const zone of DOCK_ZONES) {
      for (const lane of this.snapshot.visible.zones[zone]) {
        for (const group of lane.groups) for (const id of group.panels) shownIn.set(id, group.id)
      }
    }
    for (const [id, host] of this.hosts) {
      const body = host.parentElement?.hasAttribute("data-dock-group-body") ? host.parentElement : null
      if (body) {
        const groupId = body.closest("[data-dock-group]")?.getAttribute("data-dock-group")
        const registered = this.registrations.has(id)
        if (registered && groupId != null && shownIn.get(id) === groupId) continue
        hideHost(host)
        if (registered) continue
      } else if (!this.registrations.has(id)) {
        // Released hosts already left; one never shown stays wherever it is.
        continue
      }
      if (host.parentElement !== container) container.appendChild(host)
    }
  }

  /**
   * The frame folds or unfolds lanes at render time (window width), which
   * re-parents host elements without any layout change: it calls this first.
   */
  prepareStructuralChange() {
    this.captureMoveState()
  }

  /** Which side zones the frame renders folded; folded zones offer no new-column targets. */
  setFold(fold: DockFold) {
    this.fold = fold
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
      // A newly mounted lane or fold column gets its real width from the resize
      // library's own layout effect, which re-renders after this commit. Content
      // that reflows meanwhile (wrapping rows) has its offset rescaled by scroll
      // anchoring, so put the offsets back once more, still before paint.
      queueMicrotask(() => restoreScroll(records))
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
    const title = (id: string) => this.registrations.get(id)?.meta.title ?? id
    const laneLabel = (lane: VisibleDockLane) => lane.groups.flatMap((group) => group.panels).map(title).join(", ")
    const laneElement = (laneId: string) => [...frame.querySelectorAll<HTMLElement>("[data-dock-lane]")]
      .find((element) => element.dataset.dockLane === laneId) ?? null

    for (const element of frame.querySelectorAll<HTMLElement>("[data-dock-group]")) {
      const groupId = element.dataset.dockGroup!
      const zone = element.dataset.dockGroupZone as DockZone
      const lanes = visible.zones[zone] ?? []
      const laneIndex = lanes.findIndex((candidate) => candidate.groups.some((group) => group.id === groupId))
      const lane = lanes[laneIndex]
      const group = lane?.groups.find((candidate) => candidate.id === groupId)
      if (!lane || !group) continue
      const rect = toRect(element.getBoundingClientRect())
      const groupLabel = group.panels.map(title).join(", ")
      const soleSelf = group.panels.length === 1 && group.panels[0] === panelId
      if (soleSelf) continue
      const horizontal = zone === "bottom"

      // Side zones, unfolded: strips on the group's inner and outer edges start a new column.
      let middle = rect
      if (zone !== "bottom" && !this.fold[zone]) {
        const strip = Math.min(LANE_EDGE_MAX, rect.width * LANE_EDGE_RATIO)
        const laneRect = toRect((laneElement(lane.id) ?? element).getBoundingClientRect())
        // The centre is left of the right zone and right of the left zone.
        const innerIsLeft = zone === "right"
        const leftStrip: DockRect = { ...rect, width: strip }
        const rightStrip: DockRect = { ...rect, left: rect.left + rect.width - strip, width: strip }
        const leftHalf: DockRect = { ...laneRect, width: laneRect.width / 2 }
        const rightHalf: DockRect = { ...laneRect, left: laneRect.left + laneRect.width / 2, width: laneRect.width / 2 }
        const own = ownLaneIndex(lanes, panelId)
        // Right beside the dragged panel's own column nothing would change.
        const innerNoop = own !== null && (own === laneIndex || own === laneIndex - 1)
        const outerNoop = own !== null && (own === laneIndex || own === laneIndex + 1)
        if (!innerNoop) {
          candidates.push({
            target: { kind: "lane", laneId: lane.id, side: "inner" },
            hit: innerIsLeft ? leftStrip : rightStrip,
            preview: innerIsLeft ? leftHalf : rightHalf,
            label: `New column ${innerIsLeft ? "left" : "right"} of ${laneLabel(lane)}`,
          })
        }
        // The outermost lane's outer strip is the zone edge, added below.
        if (!outerNoop && laneIndex < lanes.length - 1) {
          candidates.push({
            target: { kind: "lane", laneId: lane.id, side: "outer" },
            hit: innerIsLeft ? rightStrip : leftStrip,
            preview: innerIsLeft ? rightHalf : leftHalf,
            label: `New column ${innerIsLeft ? "right" : "left"} of ${laneLabel(lane)}`,
          })
        }
        middle = { ...rect, left: rect.left + strip, width: rect.width - 2 * strip }
      }

      const edge = (horizontal ? middle.width : middle.height) * GROUP_EDGE_RATIO
      const before: DockRect = horizontal
        ? { ...middle, width: edge }
        : { ...middle, height: edge }
      const after: DockRect = horizontal
        ? { ...middle, left: middle.left + middle.width - edge, width: edge }
        : { ...middle, top: middle.top + middle.height - edge, height: edge }
      const centre: DockRect = horizontal
        ? { ...middle, left: middle.left + edge, width: middle.width - 2 * edge }
        : { ...middle, top: middle.top + edge, height: middle.height - 2 * edge }
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
      candidates.push({ target: { kind: "tab", groupId }, hit: centre, preview: rect, label: `Tab with ${groupLabel}` })
    }

    const column = frame.querySelector<HTMLElement>("[data-dock-column]")
    const center = frame.querySelector<HTMLElement>("[data-dock-center]")
    if (column && center) {
      const frameRect = toRect(frame.getBoundingClientRect())
      const columnRect = toRect(column.getBoundingClientRect())
      const centerRect = toRect(center.getBoundingClientRect())
      for (const zone of DOCK_ZONES) {
        const lanes = visible.zones[zone]
        if (lanes.length > 0) {
          // A side zone in use: its outer edge starts a new outermost column.
          if (zone === "bottom" || this.fold[zone]) continue
          if (ownLaneIndex(lanes, panelId) === lanes.length - 1) continue
          const outer = lanes[lanes.length - 1]!
          const element = laneElement(outer.id)
          if (!element) continue
          const laneRect = toRect(element.getBoundingClientRect())
          const strip = Math.min(LANE_EDGE_MAX, laneRect.width * LANE_EDGE_RATIO)
          candidates.push({
            target: { kind: "edge", zone },
            hit: zone === "left"
              ? { ...laneRect, left: frameRect.left, width: laneRect.left + strip - frameRect.left }
              : { ...laneRect, left: laneRect.left + laneRect.width - strip, width: frameRect.left + frameRect.width - (laneRect.left + laneRect.width - strip) },
            preview: zone === "left"
              ? { ...laneRect, width: laneRect.width / 2 }
              : { ...laneRect, left: laneRect.left + laneRect.width / 2, width: laneRect.width / 2 },
            label: `New column at the ${zone} edge`,
          })
          continue
        }
        if (visible.collapsed[zone].length > 0) continue
        const declared = this.registrations.get(panelId)?.meta.defaultSize
        const span = zone === "bottom" ? centerRect.height : columnRect.width
        const size = (typeof declared === "string" ? (parseFloat(declared) / 100) * span : declared)
          ?? FALLBACK_ZONE_SIZE[zone]
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
    // Zone edges win over the group regions they may overlap, then the new-column strips.
    const rank = (candidate: DockDropCandidate) => {
      const kind = candidate.target.kind
      return kind === "zone" || kind === "edge" ? 0 : kind === "lane" ? 1 : 2
    }
    return candidates.sort((a, b) => rank(a) - rank(b))
  }
}

/** Index of the visible lane the dragged panel has to itself (no other shown panel), or null. */
function ownLaneIndex(lanes: readonly VisibleDockLane[], panelId: string): number | null {
  const index = lanes.findIndex((lane) => lane.groups.some((group) => group.panels.includes(panelId)))
  if (index < 0) return null
  const lane = lanes[index]!
  return lane.groups.length === 1 && lane.groups[0]!.panels.length === 1 && lane.collapsed.length === 0 ? index : null
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
    && a.minSize === b.minSize && a.maxSize === b.maxSize && a.defaultSize === b.defaultSize && a.surface === b.surface
    && a.collapsible === b.collapsible && a.closable === b.closable && a.affinity === b.affinity
}

export const DOCK_DEFAULT_ZONE_SIZE = FALLBACK_ZONE_SIZE
