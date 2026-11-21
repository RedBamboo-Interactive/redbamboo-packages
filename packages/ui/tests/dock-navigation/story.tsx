import * as React from "react"
import { createRoot } from "react-dom/client"

import { DockFrame, DockHost, DockPanel, PanelHeader } from "../../src/index"
import "./story.css"

declare global {
  interface Window {
    __mounts: Record<string, number>
  }
}
window.__mounts = {}

// `?slot=leading` puts Back where callers used to (the identity slot), to pin
// that the identity is what a tab group hides; the default is the `back` slot.
const slot = new URLSearchParams(window.location.search).get("slot") === "leading" ? "leading" : "back"

const PAGES: Record<string, string[]> = {
  pages: ["Alpha", "Beta", "Gamma"],
  bookmarks: ["Inbox", "Starred"],
}

/** A pane with its own navigation history, like Settings' stacked sections or Nova's archives. */
function HistoryPane({ name, title }: { name: string; title: string }) {
  const [stack, setStack] = React.useState<string[]>([])
  React.useEffect(() => {
    window.__mounts[name] = (window.__mounts[name] ?? 0) + 1
  }, [name])
  const current = stack.at(-1)
  const back = stack.length > 0 ? (
    <button
      type="button"
      aria-label={`Back in ${title}`}
      onClick={() => setStack((previous) => previous.slice(0, -1))}
      className="inline-flex h-7 w-7 items-center justify-center rounded text-text-muted"
    >
      <i className="ph-bold ph-arrow-left" aria-hidden="true" />
    </button>
  ) : undefined
  return (
    <div className="flex h-full flex-col" data-testid={`${name}-pane`} data-location={stack.join("/")}>
      <PanelHeader title={current ?? title} {...(slot === "back" ? { back } : { leading: back })} />
      <div className="flex flex-col gap-1 p-3 text-sm">
        {PAGES[name]!.map((page) => (
          <button
            key={page}
            type="button"
            data-testid={`${name}-open-${page}`}
            onClick={() => setStack((previous) => [...previous, page])}
            className="rounded px-2 py-1 text-left hover:bg-overlay-6"
          >
            Open {page}
          </button>
        ))}
      </div>
    </div>
  )
}

function Story() {
  React.useLayoutEffect(() => {
    document.documentElement.classList.add("dark")
  }, [])
  return (
    <DockHost layoutId="navigation" storagePrefix="story:dock-navigation">
      <div className="flex h-full flex-col">
        <DockFrame>
          <main data-testid="main" className="h-full p-4 text-sm">Main content</main>
        </DockFrame>
        <DockPanel id="pages" title="Pages" icon="ph-bold ph-files" order={10} defaultSize={360} minSize={200}>
          <HistoryPane name="pages" title="Pages" />
        </DockPanel>
        <DockPanel id="bookmarks" title="Bookmarks" icon="ph-bold ph-bookmark" order={20} defaultSize={360} minSize={200}>
          <HistoryPane name="bookmarks" title="Bookmarks" />
        </DockPanel>
      </div>
    </DockHost>
  )
}

createRoot(document.getElementById("root")!).render(<Story />)
