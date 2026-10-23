import * as React from "react"
import { createRoot } from "react-dom/client"

import {
  DockFrame,
  DockHost,
  DockPanel,
  MasterDetailLayout,
  PanelHeader,
  UiEnvironmentProvider,
  useDockController,
} from "../../src/index"
import "./story.css"

declare global {
  interface Window {
    __mounts: Record<string, number>
  }
}
window.__mounts = {}

/** Counts real mounts. The story does not use StrictMode, so one mount means no remount. */
function useMountCount(name: string) {
  React.useEffect(() => {
    window.__mounts[name] = (window.__mounts[name] ?? 0) + 1
  }, [name])
}

function useNarrow() {
  const query = "(max-width: 1023px)"
  const [narrow, setNarrow] = React.useState(() => window.matchMedia(query).matches)
  React.useEffect(() => {
    const media = window.matchMedia(query)
    const update = () => setNarrow(media.matches)
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [])
  return narrow
}

const ROWS = Array.from({ length: 120 }, (_, index) => `Discussion ${index + 1}`)

function DiscussionList({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }) {
  useMountCount("list")
  return (
    <>
      <PanelHeader title="Discussions">
        <button type="button" aria-label="New discussion" className="px-1 text-xs">+</button>
      </PanelHeader>
      <div data-testid="list-scroll" className="min-h-0 flex-1 overflow-y-auto">
        {ROWS.map((row, index) => (
          <button
            key={row}
            type="button"
            aria-selected={index === selected}
            data-testid={`row-${index}`}
            onClick={() => onSelect(index)}
            className="story-plugin-row block w-full px-3 py-2 text-left text-sm aria-selected:bg-overlay-12"
          >
            {row}
          </button>
        ))}
      </div>
    </>
  )
}

function Chat({ selected }: { selected: number }) {
  useMountCount("chat")
  const [draft, setDraft] = React.useState("")
  return (
    <div className="flex h-full flex-col">
      <PanelHeader title={ROWS[selected]} />
      <div className="flex-1 p-3 text-sm" data-testid="chat-body">Transcript for {ROWS[selected]}</div>
      <textarea
        data-testid="composer"
        aria-label="Message"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className="m-3 h-20 rounded border border-overlay-12 bg-transparent p-2 text-sm"
      />
    </div>
  )
}

function NovaLikeApp() {
  const [selected, setSelected] = React.useState(0)
  // Stand-in for a federated plugin boundary: its portal container carries the CSS scope.
  const [portal, setPortal] = React.useState<HTMLDivElement | null>(null)
  React.useLayoutEffect(() => {
    const container = document.createElement("div")
    container.dataset.pluginCss = "story-plugin"
    container.dataset.contrast = "high"
    container.className = "dark"
    container.style.display = "contents"
    document.body.appendChild(container)
    setPortal(container)
    return () => container.remove()
  }, [])
  if (!portal) return null
  return (
    <div data-plugin-css="story-plugin" style={{ display: "contents" }}>
      <UiEnvironmentProvider document={document} portalContainer={portal}>
        <MasterDetailLayout
          layoutKey="story-discussions"
          mobileLabels={["Discussions", "Chat"]}
          sidebar={<DiscussionList selected={selected} onSelect={setSelected} />}
          detail={<Chat selected={selected} />}
        />
      </UiEnvironmentProvider>
    </div>
  )
}

function ToolPanel({ name, title, onClose }: { name: string; title: string; onClose: () => void }) {
  useMountCount(name)
  return (
    <div className="flex h-full flex-col" data-testid={`${name}-panel`}>
      <PanelHeader title={title}>
        <button type="button" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose} className="px-1 text-xs">x</button>
      </PanelHeader>
      <div data-testid={`${name}-scroll`} className="min-h-0 flex-1 overflow-y-auto p-3 text-xs">
        {Array.from({ length: 80 }, (_, index) => <p key={index}>{title} line {index + 1}</p>)}
      </div>
    </div>
  )
}

function HeaderlessPanel() {
  useMountCount("notes")
  return <div data-testid="notes-panel" className="h-full p-3 text-xs">Notes have no PanelHeader.</div>
}

function Controls({ app, setApp, open, toggle }: {
  app: string
  setApp: (app: string) => void
  open: Record<string, boolean>
  toggle: (name: string) => void
}) {
  const dock = useDockController()
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-overlay-6 px-3 text-xs">
      <button type="button" data-testid="app-a" aria-pressed={app === "a"} onClick={() => setApp("a")}>App A</button>
      <button type="button" data-testid="app-b" aria-pressed={app === "b"} onClick={() => setApp("b")}>App B</button>
      {["console", "settings", "history", "notes"].map((name) => (
        <button key={name} type="button" data-testid={`toggle-${name}`} aria-pressed={!!open[name]} onClick={() => toggle(name)}>
          {name}
        </button>
      ))}
      <button type="button" data-testid="reset" onClick={() => dock?.resetLayout()}>Reset layout</button>
      <span data-testid="dock-state">{JSON.stringify(dock?.panels.map((panel) => [panel.id, panel.zone, panel.collapsed]) ?? [])}</span>
    </div>
  )
}

function Story() {
  useMountCount("story")
  const params = new URLSearchParams(window.location.search)
  const [app, setApp] = React.useState(params.get("app") ?? "a")
  const narrow = useNarrow()
  const [open, setOpen] = React.useState<Record<string, boolean>>({})
  const toggle = (name: string) => setOpen((current) => ({ ...current, [name]: !current[name] }))
  const close = (name: string) => setOpen((current) => ({ ...current, [name]: false }))

  React.useLayoutEffect(() => {
    document.documentElement.classList.add("dark")
  }, [])

  return (
    <DockHost layoutId={app} storagePrefix="story:dock" enabled={!narrow}>
      <div className="flex h-full flex-col">
        <Controls app={app} setApp={setApp} open={open} toggle={toggle} />
        <DockFrame>
          <main data-testid="main" className="h-full">
            {app === "a" ? <NovaLikeApp /> : <div className="p-4 text-sm" data-testid="app-b-content">App B has no list.</div>}
          </main>
        </DockFrame>
        <DockPanel id="history" title="History" icon="ph-bold ph-clock" order={20} defaultSize={340} minSize={180} open={!!open.history} onClose={() => close("history")}>
          <ToolPanel name="history" title="History" onClose={() => close("history")} />
        </DockPanel>
        <DockPanel id="console" title="Console" icon="ph-bold ph-terminal" order={30} defaultSize={340} minSize={180} open={!!open.console} onClose={() => close("console")}>
          <ToolPanel name="console" title="Console" onClose={() => close("console")} />
        </DockPanel>
        <DockPanel id="settings" title="Settings" icon="ph-bold ph-gear" order={40} defaultSize={340} minSize={180} open={!!open.settings} onClose={() => close("settings")}>
          <ToolPanel name="settings" title="Settings" onClose={() => close("settings")} />
        </DockPanel>
        <DockPanel id="notes" title="Notes" icon="ph-bold ph-note" defaultZone="bottom" open={!!open.notes}>
          <HeaderlessPanel />
        </DockPanel>
      </div>
    </DockHost>
  )
}

createRoot(document.getElementById("root")!).render(<Story />)
