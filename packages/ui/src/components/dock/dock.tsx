import {
  createContext,
  Fragment,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react"
import { createPortal } from "react-dom"
import { Group, Panel, Separator, type Layout } from "react-resizable-panels"
import { cn } from "../../utils"
import { useUiEnvironment, type UiEnvironment } from "../../ui-environment"
import { Button } from "../button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../dropdown-menu"
import {
  computeFold,
  DOCK_CENTER_FLOOR,
  DOCK_ZONES,
  findPanel,
  type DockAffinity,
  type DockFold,
  type DockZone,
  type VisibleDockGroup,
  type VisibleDockLane,
} from "./layout"
import { DockStore, DOCK_DEFAULT_ZONE_SIZE, type DockDragState, type DockPanelMeta, type DockSize, type DockSnapshot, type DockSurface } from "./store"
import { HostSlot, useStableHost } from "./host-slot"
import { ResizablePanel, ResizablePanelGroup } from "../resizable"

const DockStoreContext = createContext<DockStore | null>(null)

interface DockPanelContextValue {
  store: DockStore
  panelId: string
}

const DockPanelContext = createContext<DockPanelContextValue | null>(null)

/** The CSS scope docked content must carry (a federated plugin's), or null. */
const DockScopeContext = createContext<ScopeAttributes | null>(null)

const noopSubscribe = () => () => {}
const DRAG_THRESHOLD = 4
const RAIL_SIZE = 36
const ZONE_LABEL: Record<DockZone, string> = { left: "left", right: "right", bottom: "bottom" }
const INTERACTIVE = "button, a[href], input, textarea, select, [role='button'], [role='menuitem'], [role='switch'], [role='checkbox'], [contenteditable=''], [contenteditable='true'], [data-dock-no-drag]"

// ---------------------------------------------------------------------------
// Host
// ---------------------------------------------------------------------------

export interface DockHostProps {
  /** Identity of the layout being edited, typically the active app id. */
  layoutId: string
  /** localStorage prefix; the key is `<prefix>:<layoutId>:v1`. Omit to keep layouts in memory. */
  storagePrefix?: string | null
  /** Docking is off when false: `useDockPanel` reports `docked: false` and callers render inline. */
  enabled?: boolean
  children: ReactNode
}

export function DockHost({ layoutId, storagePrefix = null, enabled = true, children }: DockHostProps) {
  const environment = useUiEnvironment()
  const [store] = useState(() => new DockStore(environment.document, { layoutId, storagePrefix, enabled }))
  return (
    <DockStoreContext.Provider value={store}>
      <DockConfigSync store={store} layoutId={layoutId} storagePrefix={storagePrefix} enabled={enabled} />
      {children}
    </DockStoreContext.Provider>
  )
}

/** First child, so its layout effect switches layouts before newly mounted panels register. */
function DockConfigSync({ store, layoutId, storagePrefix, enabled }: { store: DockStore; layoutId: string; storagePrefix: string | null; enabled: boolean }) {
  useLayoutEffect(() => {
    store.configure({ layoutId, storagePrefix, enabled })
  }, [store, layoutId, storagePrefix, enabled])
  return null
}

function useDockSnapshot(store: DockStore): DockSnapshot {
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

function useRequiredStore(): DockStore {
  const store = useContext(DockStoreContext)
  if (!store) throw new Error("Dock components must render inside <DockHost>")
  return store
}

// ---------------------------------------------------------------------------
// Panel registration
// ---------------------------------------------------------------------------

export interface DockPanelOptions {
  title: string
  /** Phosphor icon class, e.g. `ph-bold ph-terminal`. */
  icon?: string
  defaultZone?: DockZone
  /** Default stacking order among new groups of the same zone. */
  order?: number
  minSize?: number
  maxSize?: number
  /**
   * Zone thickness used when this panel is the first to size its zone: pixels, or a
   * share of the dock frame ("26.3%") that stays proportional until the user resizes.
   */
  defaultSize?: DockSize
  /**
   * What the panel paints behind its header row and body, as one surface.
   * "elevated" (default) is the list's surface, which Ambience turns into a
   * translucent blur over the wallpaper; "none" opts out and lets the shell show
   * through, for a panel that genuinely needs to paint nothing.
   */
  surface?: DockSurface
  /**
   * Placement kind (default "tools"). When the panel first appears it joins the
   * innermost column of its default zone holding panels of the same kind, else
   * gets a column of its own: beside the centre for tools, at the screen edge
   * for the app's list. A saved placement always wins.
   */
  affinity?: DockAffinity
  collapsible?: boolean
  content: ReactNode
  onClose?: () => void
  /** Register only while true (default true). Closing unregisters and unmounts the content. */
  open?: boolean
  /** Never dock; the caller renders the content inline. */
  disabled?: boolean
}

export interface DockPanelHandle {
  /** The dock renders the content; the caller must render `element` and nothing else for it. */
  docked: boolean
  /** Portal into the panel's stable host element; null when not docked. */
  element: ReactNode
}

export function useDockPanel(id: string, options: DockPanelOptions): DockPanelHandle {
  const store = useContext(DockStoreContext)
  const insidePanel = useContext(DockPanelContext) !== null
  const environment = useUiEnvironment()
  const enabled = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => store?.isEnabled() ?? false,
    () => false,
  )
  const wanted = store !== null && (options.open ?? true) && !options.disabled && !insidePanel
  const [token] = useState(() => ({ id }))
  const [rejected, setRejected] = useState(false)
  const active = wanted && enabled && !rejected

  const {
    title, icon, defaultZone = "right", order, minSize, maxSize, defaultSize, surface = "elevated", affinity = "tools", collapsible = false,
  } = options
  const closable = typeof options.onClose === "function"
  const meta = useMemo<DockPanelMeta>(
    () => ({ title, icon, defaultZone, order, minSize, maxSize, defaultSize, surface, affinity, collapsible, closable }),
    [title, icon, defaultZone, order, minSize, maxSize, defaultSize, surface, affinity, collapsible, closable],
  )
  const metaRef = useRef(meta)
  metaRef.current = meta
  const onCloseRef = useRef(options.onClose)
  onCloseRef.current = options.onClose
  const close = useCallback(() => onCloseRef.current?.(), [])

  useLayoutEffect(() => {
    if (!store || !wanted || !enabled) return
    if (!store.claim(id, token, metaRef.current, close)) {
      setRejected(true)
      return
    }
    return () => store.release(id, token)
  }, [store, id, token, wanted, enabled, close])

  useLayoutEffect(() => {
    if (active) store!.update(id, token, meta, close)
  }, [active, store, id, token, meta, close])

  const panelContext = useMemo(() => (store ? { store, panelId: id } : null), [store, id])
  const element = active && store
    ? createPortal(
        <DockPanelContext.Provider value={panelContext}>
          <DockScope environment={environment}>{options.content}</DockScope>
        </DockPanelContext.Provider>,
        store.hostElement(id),
        `dock:${id}`,
      )
    : null
  return { docked: active, element }
}

export interface DockPanelProps extends Omit<DockPanelOptions, "content"> {
  id: string
  children: ReactNode
  /** Rendered in place when the panel is not docked. */
  fallback?: ReactNode
}

/** Component form of `useDockPanel`, convenient for conditionally open panels. */
export function DockPanel({ id, children, fallback = null, ...options }: DockPanelProps) {
  const handle = useDockPanel(id, { ...options, content: children })
  return <>{handle.docked ? handle.element : fallback}</>
}

/** True inside content rendered by a dock panel. */
export function useIsInDockPanel(): boolean {
  return useContext(DockPanelContext) !== null
}

interface ScopeAttributes {
  pluginCss?: string
  contrast?: string
  className?: string
}

function readScope(container: HTMLElement): ScopeAttributes {
  return {
    pluginCss: container.dataset.pluginCss,
    contrast: container.dataset.contrast,
    className: container.className || undefined,
  }
}

/**
 * Federated plugins scope their stylesheet to `[data-plugin-css="<id>"]` and
 * mirror theme state onto their portal container. Docked content leaves the
 * plugin's DOM subtree, so it re-enters the same scope from that container.
 */
function DockScope({ environment, children }: { environment: UiEnvironment; children: ReactNode }) {
  const container = environment.portalContainer
  const scoped = container !== environment.document.body && container.hasAttribute("data-plugin-css")
  const [scope, setScope] = useState<ScopeAttributes>(() => (scoped ? readScope(container) : {}))
  useLayoutEffect(() => {
    if (!scoped) return
    const sync = () => setScope(readScope(container))
    sync()
    const view = container.ownerDocument.defaultView ?? window
    const observer = new view.MutationObserver(sync)
    observer.observe(container, { attributes: true, attributeFilter: ["class", "data-contrast", "data-plugin-css"] })
    return () => observer.disconnect()
  }, [container, scoped])
  if (!scoped) return <DockScopeContext.Provider value={null}>{children}</DockScopeContext.Provider>
  return (
    <DockScopeContext.Provider value={scope}>
      <ScopeAttributesWrapper scope={scope}>{children}</ScopeAttributesWrapper>
    </DockScopeContext.Provider>
  )
}

function ScopeAttributesWrapper({ scope, children }: { scope: ScopeAttributes; children: ReactNode }) {
  return (
    <div
      data-plugin-css={scope.pluginCss}
      data-contrast={scope.contrast}
      className={scope.className}
      style={{ display: "contents" }}
    >
      {children}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Controller (palette commands, shell menus)
// ---------------------------------------------------------------------------

export interface DockPanelInfo {
  id: string
  title: string
  icon?: string
  zone: DockZone | null
  collapsible: boolean
  collapsed: boolean
  /** Shares its column with another shown panel in a side zone, so it can get its own. */
  canMoveToOwnColumn: boolean
}

export interface DockController {
  enabled: boolean
  layoutId: string
  panels: DockPanelInfo[]
  movePanel(panelId: string, zone: DockZone): void
  /** A new column beside the panel's current one: toward the centre for tools, the edge for a list. */
  moveToOwnColumn(panelId: string): void
  setCollapsed(panelId: string, collapsed: boolean): void
  resetLayout(): void
}

export function useDockController(): DockController | null {
  const store = useContext(DockStoreContext)
  const snapshot = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => store?.getSnapshot() ?? null,
    () => store?.getSnapshot() ?? null,
  )
  return useMemo(() => {
    if (!store || !snapshot) return null
    const panels: DockPanelInfo[] = []
    for (const [id, meta] of snapshot.panels) {
      panels.push({
        id,
        title: meta.title,
        icon: meta.icon,
        zone: findPanel(snapshot.layout, id)?.zone ?? null,
        collapsible: meta.collapsible,
        collapsed: snapshot.layout.collapsed.includes(id),
        canMoveToOwnColumn: store.canMoveToOwnLane(id),
      })
    }
    return {
      enabled: snapshot.enabled,
      layoutId: snapshot.layoutId,
      panels,
      movePanel: (panelId, zone) => store.moveToZone(panelId, zone),
      moveToOwnColumn: (panelId) => store.moveToOwnLane(panelId),
      setCollapsed: (panelId, collapsed) => store.setCollapsed(panelId, collapsed),
      resetLayout: () => store.reset(),
    }
  }, [store, snapshot])
}

// ---------------------------------------------------------------------------
// Header integration (used by PanelHeader)
// ---------------------------------------------------------------------------

export interface DockedHeaderBinding {
  /** The header's in-place container; hidden while the dock shows the header in its row. */
  containerRef: RefObject<HTMLDivElement | null>
  /** Stable element the header renders its content into. */
  contentHost: HTMLElement
  /** This is the panel's header, shown in the dock group's header row. */
  primary: boolean
  /** In a tab group the tabs name the panel, so only the header's actions are shown. */
  mode: "single" | "tab" | null
  /** Wraps content so a federated plugin's CSS scope survives the move into the row. */
  wrap: (content: ReactNode) => ReactNode
}

/**
 * The dock owns one header row per group. A `PanelHeader` inside a dock panel
 * renders its content into a stable host: the panel's first header is taken
 * over (the dock moves that host into the group's header row and the in-place
 * header is hidden); any other header keeps its host in place. Moving the host
 * never remounts the header's content.
 */
export function useDockedHeader(rowClassName: string): DockedHeaderBinding | null {
  const panel = useContext(DockPanelContext)
  const scope = useContext(DockScopeContext)
  const containerRef = useRef<HTMLDivElement>(null)
  const contentHost = useStableHost("panel-header-content", "display:contents")
  const [token] = useState(() => ({}))
  const store = panel?.store ?? null
  const primary = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => (panel ? panel.store.isPrimaryHeader(panel.panelId, token) : false),
    () => false,
  )
  const mode = useSyncExternalStore(
    store?.subscribe ?? noopSubscribe,
    () => (panel ? panel.store.headerMode(panel.panelId) : null),
    () => null,
  )
  useLayoutEffect(() => {
    if (!panel || !containerRef.current) return
    panel.store.registerHeader(panel.panelId, token, containerRef.current, contentHost, rowClassName)
    return () => panel.store.unregisterHeader(panel.panelId, token)
    // The class is kept current by the effect below, not by re-registering.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel, token, contentHost])
  useLayoutEffect(() => {
    panel?.store.setHeaderClass(panel.panelId, token, rowClassName)
  }, [panel, token, rowClassName])
  // A header the dock does not display keeps its content where it is.
  useLayoutEffect(() => {
    const container = containerRef.current
    if (!primary && container && contentHost.parentElement !== container) container.appendChild(contentHost)
  })
  const wrap = useCallback(
    (content: ReactNode) => (scope ? <ScopeAttributesWrapper scope={scope}>{content}</ScopeAttributesWrapper> : <>{content}</>),
    [scope],
  )
  if (!panel) return null
  return { containerRef, contentHost, primary, mode, wrap }
}

// ---------------------------------------------------------------------------
// Drag
// ---------------------------------------------------------------------------

type PointerDownLike = Pick<PointerEvent, "button" | "isPrimary" | "pointerId" | "clientX" | "clientY" | "target"> & {
  currentTarget: EventTarget | null
}

function startDragFrom(store: DockStore | null, panelId: string | null, event: PointerDownLike) {
  if (!store || !panelId) return
  if (event.button !== 0 || !event.isPrimary) return
  const handle = event.currentTarget as HTMLElement | null
  if (!handle) return
  const origin = event.target as Element | null
  const interactive = origin?.closest(INTERACTIVE)
  // The grip is a button but also the handle: a click opens its menu, a drag moves the panel.
  if (interactive && interactive !== handle && handle.contains(interactive)
    && !interactive.hasAttribute("data-dock-grip")) return
  trackPointerDrag(store, panelId, handle, event)
}

function useDragHandle(store: DockStore | null, panelId: string | null) {
  return useCallback((event: ReactPointerEvent<HTMLElement>) => startDragFrom(store, panelId, event), [store, panelId])
}

function trackPointerDrag(store: DockStore, panelId: string, handle: HTMLElement, event: PointerDownLike) {
  const doc = handle.ownerDocument
  const view = doc.defaultView ?? window
  const pointerId = event.pointerId
  const startX = event.clientX
  const startY = event.clientY
  let dragging = false
  let restoreBody: (() => void) | null = null

  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return
    if (!dragging) {
      if (Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY) < DRAG_THRESHOLD) return
      if (!store.startDrag(panelId, moveEvent.clientX, moveEvent.clientY)) {
        cleanup()
        return
      }
      dragging = true
      view.getSelection()?.removeAllRanges()
      const { cursor, userSelect } = doc.body.style
      doc.body.style.cursor = "grabbing"
      doc.body.style.userSelect = "none"
      restoreBody = () => {
        doc.body.style.cursor = cursor
        doc.body.style.userSelect = userSelect
      }
    }
    moveEvent.preventDefault()
    store.updateDrag(moveEvent.clientX, moveEvent.clientY)
  }

  const finish = (commit: boolean) => {
    cleanup()
    if (!dragging) return
    restoreBody?.()
    // The pointerup of a drag must not also click whatever is under it.
    const swallow = (clickEvent: MouseEvent) => {
      clickEvent.stopPropagation()
      clickEvent.preventDefault()
    }
    view.addEventListener("click", swallow, { capture: true, once: true })
    view.setTimeout(() => view.removeEventListener("click", swallow, { capture: true }), 0)
    if (commit) store.drop()
    else store.cancelDrag()
  }

  const onUp = (upEvent: PointerEvent) => {
    if (upEvent.pointerId === pointerId) finish(true)
  }
  const onCancel = (cancelEvent: PointerEvent) => {
    if (cancelEvent.pointerId === pointerId) finish(false)
  }
  const onKey = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== "Escape" || !dragging) return
    keyEvent.preventDefault()
    keyEvent.stopPropagation()
    finish(false)
  }

  function cleanup() {
    view.removeEventListener("pointermove", onMove)
    view.removeEventListener("pointerup", onUp)
    view.removeEventListener("pointercancel", onCancel)
    view.removeEventListener("keydown", onKey, { capture: true })
  }

  view.addEventListener("pointermove", onMove, { passive: false })
  view.addEventListener("pointerup", onUp)
  view.addEventListener("pointercancel", onCancel)
  view.addEventListener("keydown", onKey, { capture: true })
}

function DockDragOverlay({ store }: { store: DockStore }) {
  const drag = useSyncExternalStore(store.subscribeDrag, store.getDrag, store.getDrag)
  const environment = useUiEnvironment()
  if (!drag) return null
  return createPortal(<DragLayer drag={drag} />, environment.document.body)
}

function DragLayer({ drag }: { drag: DockDragState }) {
  const active = drag.active
  return (
    <div
      data-slot="dock-drag-overlay"
      data-dock-drop-target={active ? describeTarget(active.target) : "none"}
      className="pointer-events-none fixed inset-0 z-[90]"
    >
      {drag.candidates.map((candidate, index) => (
        <div
          key={index}
          data-dock-drop-candidate={describeTarget(candidate.target)}
          className={cn(
            "absolute rounded-sm border border-dashed",
            candidate === active ? "border-accent-teal-a50" : "border-overlay-20",
          )}
          style={rectStyle(candidate.hit)}
        />
      ))}
      {active && (
        <div
          data-slot="dock-drop-preview"
          className="absolute rounded-md border-2 border-accent-teal-a50 bg-accent-teal-a15 transition-all duration-75"
          style={rectStyle(active.preview)}
        />
      )}
      <div
        className="absolute flex max-w-60 items-center gap-1.5 rounded-md border border-overlay-20 bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md"
        // Near the right edge the label flips to the cursor's left, so it stays readable.
        style={drag.x > window.innerWidth - 300
          ? { right: window.innerWidth - drag.x + 12, top: drag.y + 12 }
          : { left: drag.x + 12, top: drag.y + 12 }}
      >
        {drag.icon && <i className={cn(drag.icon, "text-text-muted")} aria-hidden="true" />}
        <span className="truncate font-medium">{drag.title}</span>
        {active && <span className="truncate text-text-muted">· {active.label}</span>}
      </div>
    </div>
  )
}

function describeTarget(target: DockDragState["candidates"][number]["target"]): string {
  if (target.kind === "zone") return `zone:${target.zone}`
  if (target.kind === "tab") return `tab:${target.groupId}`
  if (target.kind === "lane") return `lane:${target.laneId}:${target.side}`
  if (target.kind === "edge") return `edge:${target.zone}`
  return `split:${target.groupId}:${target.side}`
}

function rectStyle(rect: { left: number; top: number; width: number; height: number }) {
  return { left: rect.left, top: rect.top, width: Math.max(0, rect.width), height: Math.max(0, rect.height) }
}

// ---------------------------------------------------------------------------
// Frame
// ---------------------------------------------------------------------------

export interface DockFrameProps {
  /** The fixed centre: main route content. It is never remounted by the dock. */
  children: ReactNode
  className?: string
}

/** One resize separator's width, which the fold computation counts per column. */
const SEPARATOR_SIZE = 1
const NO_FOLD: DockFold = { left: false, right: false }

interface LaneBounds {
  min: number
  max?: number
  /** Pixels ("320px"), or a share of the frame ("26.3%") that stays proportional until resized. */
  size: string
  proportional: boolean
}

function laneBounds(snapshot: DockSnapshot, zone: DockZone, lane: VisibleDockLane): LaneBounds {
  const metas = lane.groups.flatMap((group) => group.panels)
    .map((id) => snapshot.panels.get(id))
    .filter((meta): meta is DockPanelMeta => !!meta)
  const min = Math.max(120, ...metas.map((meta) => meta.minSize ?? 0))
  const maxes = metas.map((meta) => meta.maxSize)
  const max = maxes.length > 0 && maxes.every((value) => typeof value === "number")
    ? Math.max(min, ...(maxes as number[]))
    : undefined
  const declared = metas.find((meta) => meta.defaultSize !== undefined)?.defaultSize ?? DOCK_DEFAULT_ZONE_SIZE[zone]
  // A declared share of the frame stays a share (and proportional on window
  // resize) until the user resizes the lane, which stores pixels.
  if (lane.size === undefined && typeof declared === "string") return { min, max, size: declared, proportional: true }
  const pixels = lane.size ?? (declared as number)
  return { min, max, size: `${Math.max(min, max ? Math.min(max, pixels) : pixels)}px`, proportional: false }
}

/** The pixels a lane asks for at a given frame width (rails are fixed). */
function lanePixels(snapshot: DockSnapshot, zone: DockZone, lane: VisibleDockLane, frameWidth: number): number {
  if (lane.groups.length === 0) return RAIL_SIZE
  const bounds = laneBounds(snapshot, zone, lane)
  const raw = bounds.proportional ? (parseFloat(bounds.size) / 100) * frameWidth : parseFloat(bounds.size)
  return Math.max(bounds.min, bounds.max ? Math.min(bounds.max, raw) : raw)
}

/** Which side zones fold at this frame width. Pure: computed from the saved layout, never written back. */
function foldFor(snapshot: DockSnapshot, frameWidth: number): DockFold {
  if (!snapshot.enabled) return NO_FOLD
  const widths = (zone: "left" | "right") => snapshot.visible.zones[zone].map((lane) => lanePixels(snapshot, zone, lane, frameWidth))
  return computeFold({
    frameWidth,
    floor: DOCK_CENTER_FLOOR,
    separator: SEPARATOR_SIZE,
    lanes: { left: widths("left"), right: widths("right") },
  })
}

const capitalize = (value: string) => `${value[0]!.toUpperCase()}${value.slice(1)}`

/**
 * Lays out the three dock zones around the centre. The tree is shaped so the
 * centre keeps its position whatever zones appear: lanes are keyed siblings
 * that come and go, and panels only ever move by re-parenting host elements.
 *
 * Side lanes are direct columns of one horizontal resize group, in screen order
 * (the left zone's lanes outer to inner, then the centre, then the right zone's
 * inner to outer), so every lane keeps its own pixel width and the centre
 * absorbs window resizes. When a side's lanes and the centre floor do not fit,
 * that side renders folded: its lanes' groups stacked in one column. Folding is
 * render-time only and, like every other change here, re-parents hosts.
 */
export function DockFrame({ children, className }: DockFrameProps) {
  const store = useRequiredStore()
  const snapshot = useDockSnapshot(store)
  const frameRef = useRef<HTMLDivElement>(null)
  const parkingRef = useRef<HTMLDivElement>(null)
  const pixelsRef = useRef<Record<string, number>>({})
  const resizeIntent = useRef(false)
  const frameWidth = useRef(0)
  const [, setFoldVersion] = useState(0)
  const { enabled, visible, generation } = snapshot
  // The centre renders into one stable host for the frame's whole life, so the
  // structure around it can change (docking on/off, a bottom zone appearing)
  // without ever remounting the main content.
  const centerHost = useStableHost("dock-center-host", "height:100%;min-height:0;min-width:0;overflow:hidden")
  const centerSlot = <HostSlot host={centerHost} slot="dock-center-slot" />
  // Fold state follows the measured width (a ref, so window resizes only re-render
  // when a side actually folds or unfolds) and the current lanes.
  const fold = enabled ? foldFor(snapshot, frameWidth.current) : NO_FOLD
  const foldRef = useRef(fold)
  foldRef.current = fold

  // Each side's column structure (lanes in order, their modes, folding) has an
  // epoch. A side whose structure changes gets new panel ids; the other side
  // keeps its panels, so opening a first tool panel lays out exactly as before lanes.
  const structure = (zone: "left" | "right") => (fold[zone] ? "fold:" : "")
    + (enabled ? visible.zones[zone] : []).map((lane) => `${lane.id}=${lane.groups.length > 0 ? "groups" : "rail"}`).join(",")
  const epochs: Record<"left" | "right", number> = {
    left: useStructureEpoch(structure("left")),
    right: useStructureEpoch(structure("right")),
  }

  useLayoutEffect(() => {
    store.setFrame(frameRef.current)
    return () => store.setFrame(null)
  }, [store, enabled])

  useLayoutEffect(() => {
    store.setFold(fold)
  })

  useLayoutEffect(() => {
    const frame = frameRef.current
    const view = frame?.ownerDocument.defaultView
    if (!enabled || !frame || !view) return
    const measure = () => {
      frameWidth.current = frame.getBoundingClientRect().width
      const next = foldFor(store.getSnapshot(), frameWidth.current)
      const current = foldRef.current
      if (next.left === current.left && next.right === current.right) return
      // Hosts are about to move between lane and fold slots: keep scroll and focus.
      store.prepareStructuralChange()
      setFoldVersion((version) => version + 1)
    }
    measure()
    const observer = new view.ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [store, enabled])

  useLayoutEffect(() => {
    if (enabled) centerHost.setAttribute("data-dock-center", "")
    else centerHost.removeAttribute("data-dock-center")
  }, [centerHost, enabled])

  // The resize library swallows pointerdown at the document, so React never sees
  // it; a window capture listener runs first.
  useLayoutEffect(() => {
    const frame = frameRef.current
    const view = frame?.ownerDocument.defaultView
    if (!frame || !view) return
    const onPointerDown = (event: PointerEvent) => {
      if (frame.contains(event.target as Node) && isResizing(frame, event.target, event)) resizeIntent.current = true
    }
    view.addEventListener("pointerdown", onPointerDown, { capture: true })
    return () => view.removeEventListener("pointerdown", onPointerDown, { capture: true })
  }, [enabled])

  // Children (group bodies) have attached their panels by now.
  useLayoutEffect(() => {
    if (parkingRef.current) store.park(parkingRef.current)
    store.restoreMoveState()
  })

  // Only user resizes are saved; mounts and structural changes also report layouts.
  const markIntent = (event: { target: EventTarget | null }) => {
    if (frameRef.current && isResizing(frameRef.current, event.target)) resizeIntent.current = true
  }

  /** The lanes each zone renders as real, resizable lanes (a folded side and a multi-lane bottom render one view). */
  const realLanes = (zone: DockZone): VisibleDockLane[] => {
    const lanes = visible.zones[zone]
    if (zone === "bottom") return lanes.length === 1 ? lanes : []
    return fold[zone] && lanes.length > 1 ? [] : lanes
  }

  const saveColumnSizes = (_layout: Layout) => {
    if (!resizeIntent.current) return
    resizeIntent.current = false
    const sizes: Record<string, number> = {}
    for (const zone of DOCK_ZONES) {
      const lanes = zone === "bottom" ? visible.zones.bottom.slice(0, 1) : realLanes(zone)
      for (const lane of lanes) {
        const pixels = pixelsRef.current[lane.id]
        if (lane.groups.length > 0 && pixels) sizes[lane.id] = pixels
      }
    }
    store.setLaneSizes(sizes)
  }

  const trackPixels = (id: string) => (size: { inPixels: number }) => { pixelsRef.current[id] = size.inPixels }

  const separator = (zone: DockZone, key: string, label: string, disabled: boolean) => (
    <DockSeparator key={key} orientation={zone === "bottom" ? "vertical" : "horizontal"} disabled={disabled} label={label} />
  )

  /** One side lane: a column with its own pixel width, and the separator on its inner side. */
  const laneColumn = (zone: "left" | "right", lanes: VisibleDockLane[], index: number) => {
    const lane = lanes[index]!
    const mode = lane.groups.length > 0 ? "groups" : "rail"
    const bounds = mode === "rail" ? RAIL_BOUNDS : laneBounds(snapshot, zone, lane)
    const many = lanes.length > 1
    // Lane numbers follow screen order: the left zone is drawn outer to inner.
    const column = zone === "left" ? lanes.length - index : index + 1
    const label = `${capitalize(zone)} dock${many ? `, column ${column} of ${lanes.length}` : ""}`
    const innerRail = mode === "rail" || (index > 0 && lanes[index - 1]!.groups.length === 0)
    const panel = (
      <Panel
        // react-resizable-panels remembers layouts by panel ids and orders panels only
        // when they register: a side with a new column structure gets new ids (its
        // epoch), so its lanes register in screen order and start from their saved
        // widths. Lane content is a re-parented host and never remounts.
        id={`dock-lane-${lane.id}-${mode}-${generation}-${epochs[zone]}`}
        defaultSize={bounds.size}
        minSize={`${bounds.min}px`}
        maxSize={bounds.max ? `${bounds.max}px` : "60%"}
        groupResizeBehavior={bounds.proportional ? "preserve-relative-size" : "preserve-pixel-size"}
        onResize={trackPixels(lane.id)}
        className="min-h-0 min-w-0"
      >
        {mode === "rail"
          ? <DockRail store={store} zone={zone} laneId={lane.id} panels={lane.collapsed} snapshot={snapshot} label={`Collapsed ${label.charAt(0).toLowerCase()}${label.slice(1)}`} />
          : <DockLaneView store={store} lane={lane} snapshot={snapshot} resizeIntent={resizeIntent} label={label} persistGroups />}
      </Panel>
    )
    const handle = separator(zone, "separator", index === 0 ? `Resize ${ZONE_LABEL[zone]} dock` : `Resize ${ZONE_LABEL[zone]} dock columns`, innerRail)
    return (
      <Fragment key={`${lane.id}:${generation}:${epochs[zone]}:${mode}`}>
        {zone === "right" ? <>{handle}{panel}</> : <>{panel}{handle}</>}
      </Fragment>
    )
  }

  /** A folded side (or a multi-lane bottom): every lane's groups in one stacked view. */
  const combinedView = (zone: DockZone, lanes: VisibleDockLane[], key: string) => {
    // Stacked in screen order: left to right becomes top to bottom.
    const ordered = zone === "left" ? [...lanes].reverse() : lanes
    const combined: VisibleDockLane = {
      id: `${key}:${zone}`,
      zone,
      groups: ordered.flatMap((lane) => lane.groups),
      collapsed: ordered.flatMap((lane) => lane.collapsed),
    }
    const mode = combined.groups.length > 0 ? "groups" : "rail"
    const sized = lanes.filter((lane) => lane.groups.length > 0)
    const bounds: LaneBounds = mode === "rail" ? RAIL_BOUNDS : (() => {
      const all = sized.map((lane) => laneBounds(snapshot, zone, lane))
      const pixels = Math.max(...sized.map((lane) => lanePixels(snapshot, zone, lane, frameWidth.current)))
      const min = Math.max(...all.map((entry) => entry.min))
      return { min, size: `${Math.max(min, pixels)}px`, proportional: false }
    })()
    const label = `${capitalize(zone)} dock`
    const panel = (
      <Panel
        id={`dock-${key}-${zone}-${mode}-${generation}-${zone === "bottom" ? 0 : epochs[zone]}`}
        defaultSize={bounds.size}
        minSize={`${bounds.min}px`}
        maxSize={bounds.max ? `${bounds.max}px` : zone === "bottom" ? "70%" : "60%"}
        groupResizeBehavior="preserve-pixel-size"
        onResize={zone === "bottom" ? trackPixels(lanes[0]!.id) : undefined}
        className="min-h-0 min-w-0"
      >
        {mode === "rail"
          ? <DockRail store={store} zone={zone} panels={combined.collapsed} snapshot={snapshot} label={`Collapsed ${ZONE_LABEL[zone]} dock`} />
          : <DockLaneView store={store} lane={combined} snapshot={snapshot} resizeIntent={resizeIntent} label={label} folded={zone !== "bottom"} />}
      </Panel>
    )
    const handle = separator(zone, "separator", `Resize ${ZONE_LABEL[zone]} dock`, mode === "rail")
    return (
      <Fragment key={`${zone}:${key}:${generation}:${zone === "bottom" ? 0 : epochs[zone]}:${mode}`}>
        {zone === "left" ? <>{panel}{handle}</> : <>{handle}{panel}</>}
      </Fragment>
    )
  }

  const sideColumns = (zone: "left" | "right") => {
    const lanes = enabled ? visible.zones[zone] : []
    if (lanes.length === 0) return null
    if (fold[zone] && lanes.length > 1) return combinedView(zone, lanes, "fold")
    const columns = lanes.map((_, index) => laneColumn(zone, lanes, index))
    return zone === "left" ? columns.reverse() : columns
  }

  const bottomLanes = enabled ? visible.zones.bottom : []
  const bottom = bottomLanes.length === 0 ? null
    : bottomLanes.length === 1
      ? (() => {
          // The bottom zone's one lane, exactly as before lanes existed.
          const lane = bottomLanes[0]!
          const mode = lane.groups.length > 0 ? "groups" : "rail"
          const bounds = mode === "rail" ? RAIL_BOUNDS : laneBounds(snapshot, "bottom", lane)
          return (
            <Fragment key={`bottom:${generation}:${mode}`}>
              {separator("bottom", "separator", "Resize bottom dock", mode === "rail")}
              <Panel
                id={`dock-zone-bottom-${mode}-${generation}`}
                defaultSize={bounds.size}
                minSize={`${bounds.min}px`}
                maxSize={bounds.max ? `${bounds.max}px` : "70%"}
                groupResizeBehavior={bounds.proportional ? "preserve-relative-size" : "preserve-pixel-size"}
                onResize={trackPixels(lane.id)}
                className="min-h-0 min-w-0"
              >
                {mode === "rail"
                  ? <DockRail store={store} zone="bottom" laneId={lane.id} panels={lane.collapsed} snapshot={snapshot} label="Collapsed bottom dock" />
                  : <DockLaneView store={store} lane={lane} snapshot={snapshot} resizeIntent={resizeIntent} label="Bottom dock" persistGroups />}
              </Panel>
            </Fragment>
          )
        })()
      : combinedView("bottom", bottomLanes, "lanes")

  // Side by side lanes keep the centre at its floor; a lone lane per side keeps the old 25% minimum.
  const sideBySide = (["left", "right"] as const).some((zone) => realLanes(zone).length > 1)

  // Only the slot moves; the portal keeps one tree position (second child of
  // the fragment below) in every mode, which is what keeps the centre mounted.
  const centerPortal = createPortal(children, centerHost)

  // Docking off (narrow shell, phones): exactly the shell's previous structure,
  // one full-width panel, no frame, no zones, no handlers.
  if (!enabled) {
    return (
      <>
        <ResizablePanelGroup orientation="horizontal" className={cn("flex-1 min-h-0", className)}>
          <ResizablePanel defaultSize={100} minSize={30}>
            {centerSlot}
          </ResizablePanel>
        </ResizablePanelGroup>
        {centerPortal}
      </>
    )
  }

  return (
    <>
    <div
      ref={frameRef}
      data-slot="dock-frame"
      data-dock-enabled=""
      data-dock-fold={[fold.left && "left", fold.right && "right"].filter(Boolean).join(" ") || undefined}
      className={cn("relative flex min-h-0 min-w-0 flex-1", className)}
      onKeyDownCapture={markIntent}
    >
      <Group id="dock-columns" orientation="horizontal" className="flex h-full w-full min-h-0" onLayoutChanged={saveColumnSizes}>
        {sideColumns("left")}
        <Panel
          key="center"
          id="dock-column"
          data-dock-column=""
          minSize={sideBySide ? `${DOCK_CENTER_FLOOR}px` : "25%"}
          groupResizeBehavior="preserve-relative-size"
          className="min-h-0 min-w-0"
        >
          {/* The column only becomes a resizable group while the bottom zone is in use. */}
          {bottom ? (
            <Group id="dock-center-column" orientation="vertical" className="flex h-full w-full min-h-0 flex-col" onLayoutChanged={saveColumnSizes}>
              <Panel key="main" id="dock-main" minSize="20%" groupResizeBehavior="preserve-relative-size" className="min-h-0 min-w-0">
                {centerSlot}
              </Panel>
              {bottom}
            </Group>
          ) : centerSlot}
        </Panel>
        {sideColumns("right")}
      </Group>
      <div ref={parkingRef} data-dock-parking="" hidden />
      <DockDragOverlay store={store} />
    </div>
    {centerPortal}
    </>
  )
}

/** Increments whenever `signature` changes, so ids derived from it are never reused. */
function useStructureEpoch(signature: string): number {
  const ref = useRef({ signature, epoch: 0 })
  if (ref.current.signature !== signature) ref.current = { signature, epoch: ref.current.epoch + 1 }
  return ref.current.epoch
}

const RAIL_BOUNDS: LaneBounds = { min: RAIL_SIZE, max: RAIL_SIZE, size: `${RAIL_SIZE}px`, proportional: false }

const SEPARATOR_HIT_MARGIN = 8

/**
 * The library hit-tests a margin around each separator, so the event target may
 * be a neighbouring panel: hit-test the same margin around dock separators.
 */
function isResizing(frame: HTMLElement, target: EventTarget | null, point?: { clientX: number; clientY: number }): boolean {
  if ((target as Element | null)?.closest?.("[data-dock-separator]")) return true
  if (!point) return false
  for (const separator of frame.querySelectorAll<HTMLElement>("[data-dock-separator]")) {
    const rect = separator.getBoundingClientRect()
    if (point.clientX >= rect.left - SEPARATOR_HIT_MARGIN && point.clientX <= rect.right + SEPARATOR_HIT_MARGIN
      && point.clientY >= rect.top - SEPARATOR_HIT_MARGIN && point.clientY <= rect.bottom + SEPARATOR_HIT_MARGIN) {
      return true
    }
  }
  return false
}

function DockSeparator({ orientation, disabled, label }: { orientation: "horizontal" | "vertical"; disabled?: boolean; label: string }) {
  // `orientation` is the group's orientation: a horizontal group gets a vertical bar.
  return (
    <Separator
      data-dock-separator=""
      data-slot="resizable-handle"
      disabled={disabled}
      aria-label={label}
      className={cn(
        "relative shrink-0 bg-overlay-6 [&[data-separator=hover]]:bg-overlay-12 [&[data-separator=focus]]:bg-accent-teal-a50 [&[data-separator=active]]:bg-accent-teal-a50",
        orientation === "horizontal"
          ? "w-px after:absolute after:inset-y-0 after:-left-1 after:-right-1"
          : "h-px after:absolute after:inset-x-0 after:-top-1 after:-bottom-1",
        disabled && "pointer-events-none",
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Lanes and groups
// ---------------------------------------------------------------------------

function DockLaneView({
  store,
  lane,
  snapshot,
  resizeIntent,
  label,
  persistGroups = false,
  folded = false,
}: {
  store: DockStore
  lane: VisibleDockLane
  snapshot: DockSnapshot
  resizeIntent: RefObject<boolean>
  label: string
  /** A real lane saves its group sizes; a combined view (fold, multi-lane bottom) only lays them out. */
  persistGroups?: boolean
  folded?: boolean
}) {
  const { zone, groups, collapsed } = lane
  const horizontal = zone === "bottom"
  const saveGroupSizes = (sizes: Layout) => {
    if (!resizeIntent.current) return
    resizeIntent.current = false
    if (persistGroups) store.setGroupSizes(lane.id, sizes)
  }
  return (
    <div
      data-dock-zone={zone}
      data-dock-lane={folded ? undefined : lane.id}
      data-dock-folded={folded ? "" : undefined}
      role="region"
      aria-label={label}
      // Lanes paint nothing: the shell, and any wallpaper behind it, shows through.
      className={cn("flex h-full w-full min-h-0 min-w-0", horizontal ? "flex-row" : "flex-col")}
    >
      {collapsed.length > 0 && <CollapsedBar store={store} zone={zone} panels={collapsed} snapshot={snapshot} />}
      <Group
        id={`dock-${lane.id}-groups-${snapshot.generation}`}
        orientation={horizontal ? "horizontal" : "vertical"}
        className={cn("flex min-h-0 min-w-0 flex-1", horizontal ? "flex-row" : "flex-col")}
        onLayoutChanged={saveGroupSizes}
      >
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 && <DockSeparator orientation={horizontal ? "horizontal" : "vertical"} label="Resize dock group" />}
            <Panel
              id={group.id}
              defaultSize={persistGroups && group.size !== undefined ? `${group.size}%` : undefined}
              minSize="64px"
              className="min-h-0 min-w-0"
            >
              <DockGroupView store={store} group={group} snapshot={snapshot} />
            </Panel>
          </Fragment>
        ))}
      </Group>
    </div>
  )
}

function DockGroupView({ store, group, snapshot }: { store: DockStore; group: VisibleDockGroup; snapshot: DockSnapshot }) {
  const bodyRef = useRef<HTMLDivElement>(null)
  const multiple = group.panels.length > 1

  // Re-parent host elements into this body and expose only the active tab.
  // Inactive tabs stay laid out (visibility, not display) so their scroll survives.
  useLayoutEffect(() => {
    const body = bodyRef.current
    if (!body) return
    for (const id of group.panels) {
      store.attach(id, body)
      const host = store.hostElement(id)
      const isActive = id === group.active
      host.style.visibility = isActive ? "" : "hidden"
      host.inert = !isActive
      if (isActive) host.removeAttribute("aria-hidden")
      else host.setAttribute("aria-hidden", "true")
      const title = snapshot.panels.get(id)?.title ?? id
      if (multiple) {
        host.setAttribute("role", "tabpanel")
        host.setAttribute("aria-labelledby", tabId(id))
        host.removeAttribute("aria-label")
      } else {
        host.setAttribute("role", "region")
        host.setAttribute("aria-label", title)
        host.removeAttribute("aria-labelledby")
      }
    }
  })

  // The group is the panel's one surface: header row and body together, as the
  // active panel declares it. Theming layers (Ambience) style it by data-dock-surface.
  const surface = snapshot.panels.get(group.active)?.surface ?? "elevated"
  return (
    <div
      data-dock-group={group.id}
      data-dock-group-zone={group.zone}
      data-dock-group-lane={group.laneId}
      data-slot="dock-panel-surface"
      data-dock-surface={surface}
      className={cn("flex h-full w-full min-h-0 min-w-0 flex-col", surface === "elevated" && "bg-surface-elevated")}
    >
      <DockGroupHeader store={store} group={group} snapshot={snapshot} />
      <div ref={bodyRef} data-dock-group-body="" className="relative min-h-0 min-w-0 flex-1" />
    </div>
  )
}

/**
 * The group's one header row: grip (drag handle and panel menu), then either
 * the panel's own header (single panel) or tabs plus the active panel's header
 * actions. The panel's own close button, when it has one, is the close.
 */
function DockGroupHeader({ store, group, snapshot }: { store: DockStore; group: VisibleDockGroup; snapshot: DockSnapshot }) {
  const slotRef = useRef<HTMLDivElement>(null)
  const multiple = group.panels.length > 1
  const active = group.active
  const meta = snapshot.panels.get(active)
  const hasHeader = snapshot.headers.has(active)
  const rowRef = useRef<HTMLDivElement>(null)

  // The taken-over header is portalled from inside the panel, so React events
  // from it never reach this row: listen to the DOM instead. Tabs move themselves.
  useLayoutEffect(() => {
    const row = rowRef.current
    if (!row) return
    const onPointerDown = (event: PointerEvent) => {
      if ((event.target as Element | null)?.closest?.("[data-dock-tab]")) return
      startDragFrom(store, active, event)
    }
    row.addEventListener("pointerdown", onPointerDown)
    return () => row.removeEventListener("pointerdown", onPointerDown)
  }, [store, active])

  // Show only the active panel's taken-over header; others wait detached.
  useLayoutEffect(() => {
    const slot = slotRef.current
    if (!slot) return
    const host = hasHeader ? store.headerHost(active) : null
    for (const child of [...slot.children]) if (child !== host) slot.removeChild(child)
    if (host && host.parentElement !== slot) slot.appendChild(host)
  })

  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = group.panels.indexOf(active)
    let next: number | null = null
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % group.panels.length
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + group.panels.length) % group.panels.length
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = group.panels.length - 1
    if (next === null) return
    event.preventDefault()
    const id = group.panels[next]!
    store.activate(id)
    event.currentTarget.ownerDocument.getElementById(tabId(id))?.focus()
  }

  // The row is the panel's own header: same classes, so the same height, gaps and
  // right padding as before docking. The grip has its own slot: the left padding
  // narrows to 8px and the header's own gap (icon to title) follows the grip, so
  // the title moves right by the grip's slot, by design.
  const rowClass = (hasHeader ? snapshot.headerClasses.get(active) : undefined) ?? DEFAULT_HEADER_ROW
  return (
    <div
      data-slot="dock-group-header"
      data-dock-group-header=""
      ref={rowRef}
      data-dock-handle={active}
      className={cn(rowClass, "select-none pl-2")}
    >
      <DockPanelMenu store={store} panelId={active} />
      {multiple ? (
        <div
          role="tablist"
          aria-label={`Panels: ${group.panels.map((id) => snapshot.panels.get(id)?.title ?? id).join(", ")}`}
          className="flex min-w-0 shrink items-stretch self-stretch overflow-x-auto"
          onKeyDown={onTabKeyDown}
        >
          {group.panels.map((id) => (
            <DockTab key={id} store={store} panelId={id} meta={snapshot.panels.get(id)} active={id === active} />
          ))}
        </div>
      ) : !hasHeader && meta ? (
        <>
          {meta.icon && <i className={cn(meta.icon, "text-sm text-text-muted")} aria-hidden="true" />}
          <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-contrast">{meta.title}</span>
        </>
      ) : null}
      {/* The header's own items live here, with the row's gap. The slot is the
          dock-header container, so a header can adapt to the width it really has
          (after the grip) with @container/dock-header queries; a header rendered
          outside the dock declares the same container name on itself. */}
      <div
        ref={slotRef}
        data-dock-header-slot=""
        className={cn(
          "@container/dock-header flex min-w-0 items-center",
          multiple ? "flex-1 justify-end" : hasHeader && "flex-1",
        )}
        style={{ gap: "inherit" }}
      />
      {!hasHeader && meta?.closable && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${meta.title}`}
          title={`Close ${meta.title}`}
          onClick={() => store.close(active)}
        >
          <i className="ph-bold ph-x" aria-hidden="true" />
        </Button>
      )}
    </div>
  )
}

/** PanelHeader's default classes, for panels that bring no header of their own. */
const DEFAULT_HEADER_ROW = "flex items-center gap-2 px-3 border-b border-overlay-6 shrink-0 h-12"

function tabId(panelId: string) {
  return `dock-tab-${panelId.replace(/[^A-Za-z0-9_-]/g, "_")}`
}

function DockTab({ store, panelId, meta, active }: { store: DockStore; panelId: string; meta?: DockPanelMeta; active: boolean }) {
  const onPointerDown = useDragHandle(store, panelId)
  const title = meta?.title ?? panelId
  return (
    <div
      id={tabId(panelId)}
      role="tab"
      aria-selected={active}
      aria-controls={store.hostElement(panelId).id}
      tabIndex={active ? 0 : -1}
      data-dock-handle={panelId}
      data-dock-tab={panelId}
      onPointerDown={onPointerDown}
      onClick={() => store.activate(panelId)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          store.activate(panelId)
        }
      }}
      className={cn(
        "flex max-w-48 shrink-0 select-none items-center gap-1.5 border-b-2 px-2.5 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-teal-a50",
        active ? "border-accent-teal font-medium text-contrast" : "border-transparent text-text-muted hover:text-contrast",
      )}
    >
      {meta?.icon && <i className={cn(meta.icon, "text-[12px]")} aria-hidden="true" />}
      <span className="truncate">{title}</span>
    </div>
  )
}

function CollapsedBar({ store, zone, panels, snapshot }: { store: DockStore; zone: DockZone; panels: string[]; snapshot: DockSnapshot }) {
  const horizontal = zone === "bottom"
  return (
    <div
      data-dock-collapsed-bar={zone}
      className={cn(
        "flex shrink-0 items-center gap-1 border-overlay-6 bg-surface-base p-1",
        horizontal ? "flex-col border-r" : "flex-row border-b",
      )}
    >
      {panels.map((id) => <ExpandButton key={id} store={store} panelId={id} meta={snapshot.panels.get(id)} />)}
    </div>
  )
}

function DockRail({ store, zone, laneId, panels, snapshot, label }: {
  store: DockStore
  zone: DockZone
  laneId?: string
  panels: string[]
  snapshot: DockSnapshot
  label: string
}) {
  const horizontal = zone === "bottom"
  return (
    <div
      data-dock-zone={zone}
      data-dock-lane={laneId}
      data-dock-rail=""
      role="toolbar"
      aria-label={label}
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      className={cn(
        "flex h-full w-full items-center gap-1 bg-surface-elevated p-1",
        horizontal ? "flex-row" : "flex-col",
      )}
    >
      {panels.map((id) => <ExpandButton key={id} store={store} panelId={id} meta={snapshot.panels.get(id)} />)}
    </div>
  )
}

function ExpandButton({ store, panelId, meta }: { store: DockStore; panelId: string; meta?: DockPanelMeta }) {
  const title = meta?.title ?? panelId
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      aria-label={`Expand ${title}`}
      title={`Expand ${title}`}
      onClick={() => store.setCollapsed(panelId, false)}
    >
      <i className={meta?.icon ?? "ph-bold ph-sidebar"} aria-hidden="true" />
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Panel menu
// ---------------------------------------------------------------------------

function DockPanelMenu({ store, panelId, label }: { store: DockStore; panelId: string; label?: string }) {
  const snapshot = useDockSnapshot(store)
  const meta = snapshot.panels.get(panelId)
  if (!meta) return null
  const zone = findPanel(snapshot.layout, panelId)?.zone ?? null
  const ownColumn = store.canMoveToOwnLane(panelId)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={(
          <Button
            variant="ghost"
            size="icon-xs"
            data-dock-menu={panelId}
            data-dock-grip=""
            aria-label={label ?? `${meta.title} panel options`}
            title="Drag to move, click for options"
            className="h-6 w-4 shrink-0 cursor-grab rounded-sm text-[12px] text-text-muted active:cursor-grabbing"
          />
        )}
      >
        <i className="ph-bold ph-dots-six-vertical" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-44">
        {DOCK_ZONES.map((target) => (
          <DropdownMenuItem
            key={target}
            disabled={target === zone}
            onClick={() => store.moveToZone(panelId, target)}
          >
            <i className={cn("ph-bold", ZONE_ICON[target], "size-4 text-center")} aria-hidden="true" />
            Move to {ZONE_LABEL[target]}
          </DropdownMenuItem>
        ))}
        {zone !== "bottom" && (
          <DropdownMenuItem disabled={!ownColumn} onClick={() => store.moveToOwnLane(panelId)}>
            <i className="ph-bold ph-columns size-4 text-center" aria-hidden="true" />
            Move to own column
          </DropdownMenuItem>
        )}
        {meta.collapsible && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => store.setCollapsed(panelId, true)}>
              <i className="ph-bold ph-arrows-in-line-horizontal size-4 text-center" aria-hidden="true" />
              Collapse
            </DropdownMenuItem>
          </>
        )}
        {meta.closable && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => store.close(panelId)}>
              <i className="ph-bold ph-x size-4 text-center" aria-hidden="true" />
              Close
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

const ZONE_ICON: Record<DockZone, string> = {
  left: "ph-arrow-line-left",
  right: "ph-arrow-line-right",
  bottom: "ph-arrow-line-down",
}

export type { DockZone } from "./layout"
