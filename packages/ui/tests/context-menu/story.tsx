import * as React from "react"
import { createRoot } from "react-dom/client"

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuHost,
  ContextMenuTrigger,
  DropdownMenuItem,
  RowActionsMenu,
  UiEnvironmentProvider,
  configureContextMenu,
  registerContextMenuProvider,
  useContextTarget,
  type ContextMenuEntry,
} from "../../src/index"
import { getContextTarget } from "../../src/context-menu-core"
import "./story.css"

declare global {
  interface Window {
    __ran: string[]
    __navigated: string[]
    __palette: number
    __rowClicks: number
    __baseMenuOpened: number
    __lastPrevented: boolean | null
    __setEnabled: (enabled: boolean) => void
    __contextListeners: () => number
    __hasTarget: (selector: string) => boolean
  }
}

window.__ran = []
window.__navigated = []
window.__palette = 0
window.__rowClicks = 0
window.__baseMenuOpened = 0
window.__lastPrevented = null

// Tracks live document/window listeners, to prove "off" registers none.
const live = new Map<string, number>()
const key = (target: EventTarget, type: string, listener: EventListenerOrEventListenerObject | null) =>
  `${target === document ? "document" : "window"}:${type}:${typeof listener === "function" ? listener.name : "?"}`
const add = EventTarget.prototype.addEventListener
const remove = EventTarget.prototype.removeEventListener
EventTarget.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
  if (this === document || this === window) live.set(key(this, type, listener), (live.get(key(this, type, listener)) ?? 0) + 1)
  return add.call(this, type, listener, options)
}
EventTarget.prototype.removeEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | EventListenerOptions) {
  if (this === document || this === window) live.set(key(this, type, listener), (live.get(key(this, type, listener)) ?? 0) - 1)
  return remove.call(this, type, listener, options)
}
const HOST_LISTENERS = [
  "document:pointerdown:onPointerDown",
  "document:pointermove:onPointerMove",
  "document:pointerup:onPointerEnd",
  "document:pointercancel:onPointerEnd",
  "document:contextmenu:onContextMenu",
  "window:click:onClickCapture",
]
window.__contextListeners = () => HOST_LISTENERS.reduce((sum, name) => sum + (live.get(name) ?? 0), 0)
window.__hasTarget = (selector) => {
  const element = document.querySelector(selector)
  return Boolean(element && getContextTarget(element))
}
window.addEventListener("contextmenu", (event) => { window.__lastPrevented = event.defaultPrevented })

const record = (id: string) => () => { window.__ran.push(id) }

/** One descriptor array: the ⋮ menu and the right-click menu both render it. */
function rowEntries(id: string): ContextMenuEntry[] {
  return [
    { id: "info", label: "Info", icon: "ph-bold ph-info", shortcut: "Alt+I", run: record(`${id}:info`) },
    { id: "rename", label: "Rename", icon: "ph-bold ph-pen", run: record(`${id}:rename`), attributes: { "data-ui-action": "rename" } },
    { id: "pinned", label: "Pinned", checked: true, run: record(`${id}:pinned`) },
    { id: "busy", label: "Update title", icon: "ph-bold ph-sparkle", disabled: true },
    {
      id: "move", label: "Move to", icon: "ph-bold ph-folder", children: [
        { id: "move-inbox", label: "Inbox", run: record(`${id}:inbox`) },
        { id: "move-archive", label: "Archive", run: record(`${id}:archive`) },
      ],
    },
    { id: "sep", separator: true },
    { id: "close", label: "Close", icon: "ph-bold ph-x", danger: true, shortcut: "Alt+W", run: record(`${id}:close`) },
  ]
}

function Row({ id, style }: { id: string; style?: React.CSSProperties }) {
  const ref = React.useRef<HTMLDivElement>(null)
  useContextTarget(ref, () => rowEntries(id))
  return (
    <div ref={ref} data-row={id} style={style} className="group/row flex items-center gap-2 border-b border-border px-3 py-2">
      <button type="button" className="flex-1 text-left" onClick={() => { window.__rowClicks++ }}>Row {id}</button>
      <RowActionsMenu label={`Actions for ${id}`} entries={rowEntries(id)} />
    </div>
  )
}

// A kind provider whose permission-gated item is slow, like the shell's entity Delete.
registerContextMenuProvider({
  id: "story:entity",
  kind: "story-entity",
  match: (element) => element.getAttribute("data-story-entity"),
  getItems: (id) => [{ id: "story-open", label: "Open", run: record(`${id}:open`) }],
  getDeferredItems: (id) => new Promise<ContextMenuEntry[]>((resolve) =>
    setTimeout(() => resolve([{ id: "story-delete", label: "Delete…", danger: true, run: record(`${id}:delete`) }]), 600)),
})

/** A target whose items arrive asynchronously (like the shell's capability-checked Delete). */
function AsyncRow() {
  const ref = React.useRef<HTMLDivElement>(null)
  useContextTarget(ref, () => new Promise<ContextMenuEntry[]>((resolve) =>
    setTimeout(() => resolve([{ id: "async-delete", label: "Delete…", danger: true, run: record("async:delete") }]), 40)))
  return <div ref={ref} data-row="async" className="w-80 border border-border px-3 py-2">Async row</div>
}

/** A row inside a plugin-like CSS scope with its own portal root (like PluginCssBoundary). */
function ScopedRow() {
  const [container, setContainer] = React.useState<HTMLDivElement | null>(null)
  React.useLayoutEffect(() => {
    const element = document.createElement("div")
    element.dataset.storyScope = "plugin"
    element.style.display = "contents"
    document.body.appendChild(element)
    setContainer(element)
    return () => element.remove()
  }, [])
  const ref = React.useRef<HTMLDivElement>(null)
  return container ? (
    <UiEnvironmentProvider document={document} portalContainer={container}>
      <ScopedRowBody rowRef={ref} />
    </UiEnvironmentProvider>
  ) : null
}

function ScopedRowBody({ rowRef }: { rowRef: React.RefObject<HTMLDivElement | null> }) {
  useContextTarget(rowRef, () => [
    { id: "scoped-info", label: "Info", run: record("scoped:info") },
    { id: "scoped-float", label: "Float", className: "story-plugin-only" },
  ])
  return <div ref={rowRef} data-row="scoped" className="w-80 border border-border px-3 py-2">Scoped row</div>
}

function Story() {
  const [enabled, setEnabled] = React.useState(true)
  window.__setEnabled = setEnabled

  React.useEffect(() => configureContextMenu({
    enabled,
    navigate: (to) => window.__navigated.push(to),
    openCommandPalette: () => { window.__palette++ },
  }), [enabled])

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <ContextMenuHost />
      <div className="w-80 rounded border border-border">
        <Row id="alpha" />
        <Row id="beta" />
      </div>
      <AsyncRow />
      <div data-story-entity="e9" className="w-80 border border-border px-3 py-2">Slow entity</div>
      <ScopedRow />
      <p data-testid="links">
        <a href="/apps/nova/chat/42">Internal link</a> · <a href="https://example.com/page">External link</a>
      </p>
      <img data-testid="pic" src="/pic.svg" alt="Picture" width={64} height={40} />
      <p data-testid="prose">Selectable prose for the copy item.</p>
      <div className="flex gap-2">
        <input data-testid="input" defaultValue="text input" className="border border-border px-1" />
        <textarea data-testid="textarea" defaultValue="area" className="border border-border px-1" />
        <div data-testid="editable" contentEditable suppressContentEditableWarning className="border border-border px-1">editable</div>
      </div>
      <div data-testid="native-zone" data-context-menu="native" className="border border-dashed border-border p-2">native zone <span data-testid="native-child">child</span></div>
      <div data-testid="none-zone" data-context-menu="none" className="border border-dashed border-border p-2">canvas zone</div>
      <ContextMenu onOpenChange={(open) => { if (open) window.__baseMenuOpened++ }}>
        <ContextMenuTrigger data-testid="base-trigger" className="w-48 border border-border p-2">Send button stand-in</ContextMenuTrigger>
        <ContextMenuContent data-testid="base-menu">
          <DropdownMenuItem>Send now</DropdownMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      <div data-message-uid="m1" data-testid="chat-row" className="w-48 border border-border p-2">Chat message stand-in</div>
      <div data-testid="empty" className="h-16" />
      <Row id="corner" style={{ position: "fixed", right: 0, bottom: 0, width: 160 }} />
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<Story />)
