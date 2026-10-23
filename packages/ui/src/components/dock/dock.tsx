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
import { DOCK_ZONES, findPanel, type DockZone, type VisibleDockGroup } from "./layout"
import { DockStore, DOCK_DEFAULT_ZONE_SIZE, type DockDragState, type DockPanelMeta, type DockSnapshot } from "./store"
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
  /** Zone thickness in pixels used when this panel is the first to size its zone. */
  defaultSize?: number
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

  const { title, icon, defaultZone = "right", order, minSize, maxSize, defaultSize, collapsible = false } = options
  const closable = typeof options.onClose === "function"
  const meta = useMemo<DockPanelMeta>(
    () => ({ title, icon, defaultZone, order, minSize, maxSize, defaultSize, collapsible, closable }),
    [title, icon, defaultZone, order, minSize, maxSize, defaultSize, collapsible, closable],
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
}

export interface DockController {
  enabled: boolean
  layoutId: string
  panels: DockPanelInfo[]
  movePanel(panelId: string, zone: DockZone): void
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
      })
    }
    return {
      enabled: snapshot.enabled,
      layoutId: snapshot.layoutId,
      panels,
      movePanel: (panelId, zone) => store.moveToZone(panelId, zone),
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
export function useDockedHeader(): DockedHeaderBinding | null {
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
    panel.store.registerHeader(panel.panelId, token, containerRef.current, contentHost)
    return () => panel.store.unregisterHeader(panel.panelId, token)
  }, [panel, token, contentHost])
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
        style={{ left: drag.x + 12, top: drag.y + 12 }}
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

/**
 * Lays out the three dock zones around the centre. The tree is shaped so the
 * centre keeps its position whatever zones appear: zones are keyed siblings
 * that come and go, and panels only ever move by re-parenting host elements.
 */
export function DockFrame({ children, className }: DockFrameProps) {
  const store = useRequiredStore()
  const snapshot = useDockSnapshot(store)
  const frameRef = useRef<HTMLDivElement>(null)
  const parkingRef = useRef<HTMLDivElement>(null)
  const zonePixels = useRef<Partial<Record<DockZone, number>>>({})
  const resizeIntent = useRef(false)
  const { enabled, visible, layout, generation } = snapshot
  // The centre renders into one stable host for the frame's whole life, so the
  // structure around it can change (docking on/off, a bottom zone appearing)
  // without ever remounting the main content.
  const centerHost = useStableHost("dock-center-host", "height:100%;min-height:0;min-width:0;overflow:hidden")
  const centerSlot = <HostSlot host={centerHost} slot="dock-center-slot" />

  useLayoutEffect(() => {
    store.setFrame(frameRef.current)
    return () => store.setFrame(null)
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

  const zoneMode = (zone: DockZone): "groups" | "rail" | null => {
    if (!enabled) return null
    if (visible.zones[zone].length > 0) return "groups"
    if (visible.collapsed[zone].length > 0) return "rail"
    return null
  }
  const modes = { left: zoneMode("left"), right: zoneMode("right"), bottom: zoneMode("bottom") }

  const zoneBounds = (zone: DockZone) => {
    const metas = [...visible.zones[zone].flatMap((group) => group.panels)]
      .map((id) => snapshot.panels.get(id))
      .filter((meta): meta is DockPanelMeta => !!meta)
    const min = Math.max(120, ...metas.map((meta) => meta.minSize ?? 0))
    const maxes = metas.map((meta) => meta.maxSize)
    const max = maxes.length > 0 && maxes.every((value) => typeof value === "number")
      ? Math.max(min, ...(maxes as number[]))
      : undefined
    const fallback = metas.find((meta) => meta.defaultSize)?.defaultSize ?? DOCK_DEFAULT_ZONE_SIZE[zone]
    const size = layout.zoneSizes[zone] ?? fallback
    return { min, max, size: Math.max(min, max ? Math.min(max, size) : size) }
  }

  // Only user resizes are saved; mounts and structural changes also report layouts.
  const markIntent = (event: { target: EventTarget | null }) => {
    if (frameRef.current && isResizing(frameRef.current, event.target)) resizeIntent.current = true
  }

  const saveColumnSizes = (_layout: Layout) => {
    if (!resizeIntent.current) return
    resizeIntent.current = false
    for (const zone of ["left", "right", "bottom"] as const) {
      const pixels = zonePixels.current[zone]
      if (modes[zone] === "groups" && pixels) store.setZoneSize(zone, pixels)
    }
  }

  const zonePanel = (zone: DockZone) => {
    const mode = modes[zone]
    if (!mode) return null
    const bounds = mode === "rail" ? { min: RAIL_SIZE, max: RAIL_SIZE, size: RAIL_SIZE } : zoneBounds(zone)
    const panel = (
      <Panel
        // react-resizable-panels remembers sizes by panel id: a rail, or a freshly
        // loaded layout, must not inherit the previous panel's size.
        id={`dock-zone-${zone}-${mode}-${generation}`}
        defaultSize={`${bounds.size}px`}
        minSize={`${bounds.min}px`}
        maxSize={bounds.max ? `${bounds.max}px` : zone === "bottom" ? "70%" : "60%"}
        groupResizeBehavior="preserve-pixel-size"
        onResize={(size) => { zonePixels.current[zone] = size.inPixels }}
        className="min-h-0 min-w-0"
      >
        {mode === "rail" ? <DockRail store={store} zone={zone} panels={visible.collapsed[zone]} snapshot={snapshot} />
          : <DockZoneView store={store} zone={zone} snapshot={snapshot} resizeIntent={resizeIntent} />}
      </Panel>
    )
    const separator = (
      <DockSeparator
        orientation={zone === "bottom" ? "vertical" : "horizontal"}
        disabled={mode === "rail"}
        label={`Resize ${ZONE_LABEL[zone]} dock`}
      />
    )
    return (
      <Fragment key={`${zone}:${generation}:${mode}`}>
        {zone === "right" || zone === "bottom" ? <>{separator}{panel}</> : <>{panel}{separator}</>}
      </Fragment>
    )
  }

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
      className={cn("relative flex min-h-0 min-w-0 flex-1", className)}
      onKeyDownCapture={markIntent}
    >
      <Group id="dock-columns" orientation="horizontal" className="flex h-full w-full min-h-0" onLayoutChanged={saveColumnSizes}>
        {zonePanel("left")}
        <Panel key="center" id="dock-column" data-dock-column="" minSize="25%" groupResizeBehavior="preserve-relative-size" className="min-h-0 min-w-0">
          {/* The column only becomes a resizable group while the bottom zone is in use. */}
          {modes.bottom ? (
            <Group id="dock-center-column" orientation="vertical" className="flex h-full w-full min-h-0 flex-col" onLayoutChanged={saveColumnSizes}>
              <Panel key="main" id="dock-main" minSize="20%" groupResizeBehavior="preserve-relative-size" className="min-h-0 min-w-0">
                {centerSlot}
              </Panel>
              {zonePanel("bottom")}
            </Group>
          ) : centerSlot}
        </Panel>
        {zonePanel("right")}
      </Group>
      <div ref={parkingRef} data-dock-parking="" hidden />
      <DockDragOverlay store={store} />
    </div>
    {centerPortal}
    </>
  )
}

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
// Zones and groups
// ---------------------------------------------------------------------------

function DockZoneView({
  store,
  zone,
  snapshot,
  resizeIntent,
}: {
  store: DockStore
  zone: DockZone
  snapshot: DockSnapshot
  resizeIntent: RefObject<boolean>
}) {
  const groups = snapshot.visible.zones[zone]
  const collapsed = snapshot.visible.collapsed[zone]
  const horizontal = zone === "bottom"
  const saveGroupSizes = (sizes: Layout) => {
    if (!resizeIntent.current) return
    resizeIntent.current = false
    store.setGroupSizes(zone, sizes)
  }
  return (
    <div
      data-dock-zone={zone}
      role="region"
      aria-label={`${ZONE_LABEL[zone][0]!.toUpperCase()}${ZONE_LABEL[zone].slice(1)} dock`}
      className={cn("flex h-full w-full min-h-0 min-w-0 bg-background", horizontal ? "flex-row" : "flex-col")}
    >
      {collapsed.length > 0 && <CollapsedBar store={store} zone={zone} panels={collapsed} snapshot={snapshot} />}
      <Group
        id={`dock-${zone}-groups-${snapshot.generation}`}
        orientation={horizontal ? "horizontal" : "vertical"}
        className={cn("flex min-h-0 min-w-0 flex-1", horizontal ? "flex-row" : "flex-col")}
        onLayoutChanged={saveGroupSizes}
      >
        {groups.map((group, index) => (
          <Fragment key={group.id}>
            {index > 0 && <DockSeparator orientation={horizontal ? "horizontal" : "vertical"} label="Resize dock group" />}
            <Panel
              id={group.id}
              defaultSize={group.size !== undefined ? `${group.size}%` : undefined}
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

  return (
    <div
      data-dock-group={group.id}
      data-dock-group-zone={group.zone}
      className="flex h-full w-full min-h-0 min-w-0 flex-col"
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

  return (
    <div
      data-slot="dock-group-header"
      data-dock-group-header=""
      ref={rowRef}
      data-dock-handle={active}
      className="flex h-12 shrink-0 select-none items-center gap-1 border-b border-overlay-6 pl-1 pr-3"
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
        <span className="flex min-w-0 flex-1 items-center gap-2 pl-1 text-[14px] font-medium text-contrast">
          {meta.icon && <i className={cn(meta.icon, "text-sm text-text-muted")} aria-hidden="true" />}
          <span className="truncate">{meta.title}</span>
        </span>
      ) : null}
      <div
        ref={slotRef}
        data-dock-header-slot=""
        className={cn(
          "flex min-w-0 items-center gap-2",
          multiple ? "flex-1 justify-end" : hasHeader ? "flex-1 pl-1" : "",
        )}
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

function DockRail({ store, zone, panels, snapshot }: { store: DockStore; zone: DockZone; panels: string[]; snapshot: DockSnapshot }) {
  const horizontal = zone === "bottom"
  return (
    <div
      data-dock-zone={zone}
      data-dock-rail=""
      role="toolbar"
      aria-label={`Collapsed ${ZONE_LABEL[zone]} dock`}
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
            className="cursor-grab text-text-muted active:cursor-grabbing"
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
