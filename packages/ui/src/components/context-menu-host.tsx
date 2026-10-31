import { Fragment, useCallback, useEffect, useRef, useState } from "react"
import { UiEnvironmentProvider, useUiEnvironment } from "../ui-environment"
import {
  buildContextMenuSections,
  classifyContextMenuEvent,
  createContextMenuRunContext,
  distance,
  isContextMenuSeparator,
  isTouchGestureOwned,
  LONG_PRESS_MOVE_TOLERANCE,
  LONG_PRESS_MS,
  normalizeContextMenuEntries,
  pathElements,
  registerBuiltinContextMenuProviders,
  type ContextMenuEntry,
  type ContextMenuItem,
  type ContextMenuRunContext,
  type ContextMenuSection,
  type SelectionLike,
} from "../context-menu-core"
import { ActionMenuItems, useContextMenuConfig, useContextMenuEnabled } from "./action-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } from "./dropdown-menu"
import { Sheet } from "./sheet"

/** How long an async provider may delay the menu before it opens without it. */
const ASYNC_SECTION_WAIT_MS = 150

interface Point {
  x: number
  y: number
}

interface ResolvedSection extends Omit<ContextMenuSection, "entries" | "deferred"> {
  /** Null while an async provider is still answering. */
  entries: ContextMenuEntry[] | null
  /** Deferred items that have arrived, shown after `entries`. */
  extra: ContextMenuEntry[]
}

interface OpenMenu {
  id: number
  surface: "popup" | "sheet"
  point: Point
  anchorElement: Element | null
  sections: ResolvedSection[]
}

export interface ContextMenuHostProps {
  /** Back, Forward, Reload and Copy page link. Off in windows with no navigable page. */
  pageActions?: boolean
}

/**
 * Replaces the browser's context menu in one document (the one from
 * `useUiEnvironment()`). Mount one per document. Renders nothing and listens to
 * nothing while the user's "Leaf context menu" preference is off.
 *
 * Native menu stays for editable targets, events another handler already took
 * (`defaultPrevented`), Shift+right-click and `data-context-menu="native"`
 * subtrees; `data-context-menu="none"` suppresses both menus, as does a
 * right-drag. Touch opens a bottom sheet after a 500 ms long-press, only over
 * an object, link or media.
 */
export function ContextMenuHost(props: ContextMenuHostProps) {
  const enabled = useContextMenuEnabled()
  return enabled ? <ActiveContextMenuHost {...props} /> : null
}

function selectionAt(view: Window, target: Element | null, point: Point | null): SelectionLike | null {
  const selection = view.getSelection()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0 || !target) return null
  const text = selection.toString()
  if (!text.trim()) return null
  if (!point) return { text, containsTarget: selection.containsNode(target, true) }
  for (let index = 0; index < selection.rangeCount; index++) {
    for (const rect of Array.from(selection.getRangeAt(index).getClientRects())) {
      if (point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom)
        return { text, containsTarget: true }
    }
  }
  return { text, containsTarget: false }
}

/** Keyboard menus (Menu key, Shift+F10) report no pointer type, or no right button. */
function isKeyboardContextMenu(event: MouseEvent): boolean {
  const pointerType = (event as PointerEvent).pointerType
  return typeof pointerType === "string" ? pointerType === "" : event.button !== 2
}

function ActiveContextMenuHost({ pageActions = true }: ContextMenuHostProps) {
  const environment = useUiEnvironment()
  const [menu, setMenu] = useState<OpenMenu | null>(null)
  const sessionRef = useRef(0)
  const pageActionsRef = useRef(pageActions)
  pageActionsRef.current = pageActions

  const close = useCallback(() => setMenu(null), [])

  const ownerDocument = environment.document
  const view = environment.window
  useEffect(() => {
    registerBuiltinContextMenuProviders()

    const open = (path: EventTarget[], point: Point, surface: OpenMenu["surface"], keyboard: boolean): boolean => {
      const elements = pathElements(path)
      const target = elements[0] ?? null
      const ctx = (element: Element | null) =>
        createContextMenuRunContext({ target: element, surface: surface === "sheet" ? "sheet" : "context-menu", document: ownerDocument, window: view })
      const sections = buildContextMenuSections({
        path,
        selection: selectionAt(view, target, keyboard ? null : point),
        ctx,
        pageActions: pageActionsRef.current,
        objectsOnly: surface === "sheet",
      })
      if (sections.length === 0) return false
      const id = ++sessionRef.current
      const resolved: ResolvedSection[] = sections.map(({ entries, deferred: _deferred, ...section }) =>
        ({ ...section, entries: Array.isArray(entries) ? entries : null, extra: [] }))
      let shown = false
      let pending = 0
      const show = () => {
        if (shown || sessionRef.current !== id) return
        shown = true
        view.clearTimeout(waitTimer)
        setMenu({ id, surface, point, anchorElement: keyboard ? target : null, sections: resolved.slice() })
      }
      const settle = (index: number, update: (section: ResolvedSection) => ResolvedSection) => {
        resolved[index] = update(resolved[index])
        if (!shown) {
          if (--pending === 0) show()
          return
        }
        setMenu((current) => {
          if (!current || current.id !== id) return current
          const next = current.sections.slice()
          next[index] = update(next[index])
          return { ...current, sections: next }
        })
      }
      sections.forEach((section, index) => {
        if (!Array.isArray(section.entries)) {
          pending++
          void section.entries.then((entries) => settle(index, (current) => ({ ...current, entries })))
        }
        if (section.deferred) {
          pending++
          void section.deferred.then((extra) => settle(index, (current) => ({ ...current, extra })))
        }
      })
      // Async providers get a moment to answer so the menu does not grow under the pointer.
      const waitTimer = pending > 0 ? view.setTimeout(show, ASYNC_SECTION_WAIT_MS) : 0
      if (pending === 0) show()
      return true
    }

    // Right-drag guard.
    let rightDown: Point | null = null
    let rightDrag = 0
    // Touch long-press.
    let touch: { pointerId: number; start: Point; path: EventTarget[]; timer: number; opened: boolean; ended: boolean } | null = null
    let swallowClickUntil = 0

    const cancelTouchTimer = () => {
      if (touch) view.clearTimeout(touch.timer)
    }

    const tryTouchOpen = (path: EventTarget[], point: Point): boolean => {
      const decision = classifyContextMenuEvent({ defaultPrevented: false, shiftKey: false, composedPath: () => path })
      if (decision !== "leaf" || isTouchGestureOwned(pathElements(path))) return false
      return open(path, point, "sheet", false)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        cancelTouchTimer()
        const start = { x: event.clientX, y: event.clientY }
        const path = event.composedPath()
        const pointerId = event.pointerId
        const timer = view.setTimeout(() => {
          if (!touch || touch.pointerId !== pointerId || touch.opened || touch.ended) return
          if (tryTouchOpen(touch.path, touch.start)) {
            touch.opened = true
            // The release that ends the press belongs to the sheet, not to the row under it.
            swallowClickUntil = view.performance.now() + 1000
          }
        }, LONG_PRESS_MS)
        touch = { pointerId, start, path, timer, opened: false, ended: false }
        return
      }
      if (event.button === 2) {
        rightDown = { x: event.clientX, y: event.clientY }
        rightDrag = 0
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      if (rightDown && (event.buttons & 2)) rightDrag = Math.max(rightDrag, distance(rightDown, { x: event.clientX, y: event.clientY }))
      if (touch && event.pointerId === touch.pointerId && !touch.opened
        && distance(touch.start, { x: event.clientX, y: event.clientY }) > LONG_PRESS_MOVE_TOLERANCE) {
        cancelTouchTimer()
        touch.ended = true
      }
    }

    const onPointerEnd = (event: PointerEvent) => {
      if (touch && event.pointerId === touch.pointerId) {
        cancelTouchTimer()
        touch.ended = true
      }
    }

    const onContextMenu = (event: MouseEvent) => {
      const touchOrigin = (event as PointerEvent).pointerType === "touch" || (touch !== null && !touch.ended)
      if (touchOrigin) {
        // Android fires contextmenu for the same long-press the timer watches.
        if (event.defaultPrevented) return
        if (touch?.opened) {
          event.preventDefault()
          return
        }
        const decision = classifyContextMenuEvent(event)
        if (decision === "suppress") {
          event.preventDefault()
          return
        }
        if (decision !== "leaf") return
        const path = event.composedPath()
        if (tryTouchOpen(path, { x: event.clientX, y: event.clientY })) {
          event.preventDefault()
          cancelTouchTimer()
          if (touch) touch.opened = true
          swallowClickUntil = view.performance.now() + 1000
        }
        return
      }

      const keyboard = isKeyboardContextMenu(event)
      const decision = classifyContextMenuEvent(event, { dragDistance: rightDrag, keyboard })
      rightDown = null
      rightDrag = 0
      if (decision === "ignore" || decision === "native") return
      event.preventDefault()
      if (decision === "suppress") return
      open(event.composedPath(), { x: event.clientX, y: event.clientY }, "popup", keyboard)
    }

    const onClickCapture = (event: MouseEvent) => {
      if (swallowClickUntil === 0) return
      const swallow = view.performance.now() < swallowClickUntil
      swallowClickUntil = 0
      if (!swallow) return
      event.preventDefault()
      event.stopImmediatePropagation()
    }

    ownerDocument.addEventListener("pointerdown", onPointerDown, true)
    ownerDocument.addEventListener("pointermove", onPointerMove, true)
    ownerDocument.addEventListener("pointerup", onPointerEnd, true)
    ownerDocument.addEventListener("pointercancel", onPointerEnd, true)
    ownerDocument.addEventListener("contextmenu", onContextMenu)
    view.addEventListener("click", onClickCapture, true)
    return () => {
      cancelTouchTimer()
      ownerDocument.removeEventListener("pointerdown", onPointerDown, true)
      ownerDocument.removeEventListener("pointermove", onPointerMove, true)
      ownerDocument.removeEventListener("pointerup", onPointerEnd, true)
      ownerDocument.removeEventListener("pointercancel", onPointerEnd, true)
      ownerDocument.removeEventListener("contextmenu", onContextMenu)
      view.removeEventListener("click", onClickCapture, true)
    }
  }, [ownerDocument, view])

  if (!menu) return null
  // A registered target's menu renders in that target's portal container (a plugin's CSS
  // scope), so plugin classes on its items apply exactly as in its own ⋮ menu.
  const scoped = menu.sections.find((section) => section.role === "object")?.portalContainer
  const portalContainer = scoped && scoped.ownerDocument === ownerDocument && scoped.isConnected ? scoped : environment.portalContainer
  return (
    <UiEnvironmentProvider document={ownerDocument} portalContainer={portalContainer}>
      {menu.surface === "sheet"
        ? <ContextMenuSheet key={menu.id} menu={menu} onClose={close} />
        : <ContextMenuPopup key={menu.id} menu={menu} onClose={close} />}
    </UiEnvironmentProvider>
  )
}

function visibleSections(sections: ResolvedSection[], resolveCommand: Parameters<typeof normalizeContextMenuEntries>[1]) {
  return sections
    .map((section) => ({
      ...section,
      entries: section.entries ? normalizeContextMenuEntries([...section.entries, ...section.extra], resolveCommand) : [],
    }))
    .filter((section) => section.entries.length > 0)
}

function ContextMenuPopup({ menu, onClose }: { menu: OpenMenu; onClose: () => void }) {
  const environment = useUiEnvironment()
  const { resolveCommand } = useContextMenuConfig()
  const sections = visibleSections(menu.sections, resolveCommand)
  const anchorElement = menu.anchorElement
  const point = menu.point
  const [anchor] = useState(() => ({
    contextElement: anchorElement ?? environment.document.body,
    getBoundingClientRect: () => {
      if (anchorElement?.isConnected) {
        const rect = anchorElement.getBoundingClientRect()
        return new (environment.window as Window & typeof globalThis).DOMRect(rect.left, rect.bottom, 0, 0)
      }
      return new (environment.window as Window & typeof globalThis).DOMRect(point.x, point.y, 0, 0)
    },
  }))

  return (
    <DropdownMenu open modal={false} onOpenChange={(open) => { if (!open) onClose() }}>
      <DropdownMenuContent
        anchor={anchor}
        side="bottom"
        align="start"
        sideOffset={2}
        collisionPadding={8}
        data-slot="leaf-context-menu"
        data-context-menu="none"
        aria-label="Context menu"
        className="min-w-[13rem] max-w-[20rem]"
      >
        {sections.map((section, index) => (
          <Fragment key={section.id}>
            {index > 0 && <DropdownMenuSeparator />}
            {section.role === "page"
              ? <PageIconRow entries={section.entries} surface="context-menu" />
              : <ActionMenuItems entries={section.entries} target={section.element} surface="context-menu" />}
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function useRunContext(target: Element | null, surface: ContextMenuRunContext["surface"]) {
  const environment = useUiEnvironment()
  return () => createContextMenuRunContext({ target, surface, document: environment.document, window: environment.window })
}

function PageIconRow({ entries, surface }: { entries: ContextMenuEntry[]; surface: ContextMenuRunContext["surface"] }) {
  const ctx = useRunContext(null, surface)
  const items = entries.filter((entry): entry is ContextMenuItem => !isContextMenuSeparator(entry))
  return (
    <div role="group" aria-label="Page" data-slot="leaf-context-menu-page" className="flex items-center gap-0.5">
      {items.map((item) => (
        <DropdownMenuItem
          key={item.id}
          disabled={item.disabled}
          aria-label={item.label}
          title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
          data-menu-item={item.id}
          onClick={() => { void item.run?.(ctx()) }}
          className="size-8 justify-center p-0"
        >
          <i aria-hidden="true" className={`${item.icon ?? "ph-bold ph-circle"} size-4`} />
        </DropdownMenuItem>
      ))}
    </div>
  )
}

function ContextMenuSheet({ menu, onClose }: { menu: OpenMenu; onClose: () => void }) {
  const { resolveCommand } = useContextMenuConfig()
  const sections = visibleSections(menu.sections, resolveCommand)
  const [stack, setStack] = useState<{ item: ContextMenuItem; target: Element | null }[]>([])
  const environment = useUiEnvironment()
  const ctx = (target: Element | null) =>
    createContextMenuRunContext({ target, surface: "sheet", document: environment.document, window: environment.window })

  const choose = (item: ContextMenuItem, target: Element | null) => {
    if (item.children?.length) {
      setStack((current) => [...current, { item, target }])
      return
    }
    // Run inside the tap so actions that need user activation keep it.
    void item.run?.(ctx(target))
    onClose()
  }

  const renderItems = (entries: ContextMenuEntry[], target: Element | null) => entries.map((entry) => {
    if (isContextMenuSeparator(entry)) return <div key={entry.id} role="separator" className="mx-3 my-1 h-px bg-border" />
    return (
      <button
        key={entry.id}
        type="button"
        role="menuitem"
        disabled={entry.disabled}
        data-variant={entry.danger ? "destructive" : "default"}
        onClick={() => choose(entry, target)}
        {...entry.attributes}
        data-menu-item={entry.id}
        className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm outline-none transition-colors hover:bg-overlay-6 focus-visible:bg-overlay-6 active:bg-overlay-8 disabled:pointer-events-none disabled:opacity-50 ${entry.danger ? "text-destructive" : ""} ${entry.className ?? ""}`}
      >
        {entry.checked !== undefined
          ? <i aria-hidden="true" className={`ph-bold ${entry.checked ? "ph-check-square" : "ph-square"} size-4`} />
          : entry.icon ? <i aria-hidden="true" className={`${entry.icon} size-4`} /> : <span className="size-4" />}
        <span className="min-w-0 flex-1 truncate">{entry.label}</span>
        {entry.children?.length ? <i aria-hidden="true" className="ph-bold ph-caret-right size-4 text-text-muted" /> : null}
      </button>
    )
  })

  const top = stack[stack.length - 1]
  return (
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }} aria-label="Actions" showCloseButton={false}>
      <div role="menu" data-slot="leaf-context-sheet" data-context-menu="none" className="min-h-0 overflow-y-auto px-2 pb-3">
        {top ? (
          <>
            <button
              type="button"
              onClick={() => setStack((current) => current.slice(0, -1))}
              className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-medium text-text-muted hover:bg-overlay-6"
            >
              <i aria-hidden="true" className="ph-bold ph-caret-left size-4" />
              {top.item.label}
            </button>
            {renderItems(normalizeContextMenuEntries(top.item.children ?? [], resolveCommand), top.target)}
          </>
        ) : sections.map((section, index) => (
          <Fragment key={section.id}>
            {index > 0 && <div role="separator" className="mx-3 my-1 h-px bg-border" />}
            {renderItems(section.entries, section.element)}
          </Fragment>
        ))}
      </div>
    </Sheet>
  )
}
