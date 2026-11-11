import * as React from "react"
import { createPortal } from "react-dom"
import { createRoot } from "react-dom/client"

import {
  Toaster,
  ToastProvider,
  UiEnvironmentProvider,
  toast,
  useToast,
  type ToastApi,
} from "../../src/index"
import "./story.css"

declare global {
  interface Window {
    __toast: typeof toast
    __plugin: ToastApi
    __detached: ToastApi
    __detachedDocument: Document
  }
}

window.__toast = toast

function Expose({ name }: { name: "__plugin" | "__detached" }) {
  const api = useToast()
  React.useEffect(() => {
    window[name] = api
  }, [api, name])
  return null
}

/** A second document, like Float Nova's picture-in-picture window. */
function DetachedWindow() {
  const frame = React.useRef<HTMLIFrameElement>(null)
  const [doc, setDoc] = React.useState<Document | null>(null)

  React.useEffect(() => {
    const target = frame.current?.contentDocument
    if (!target) return
    for (const node of document.head.querySelectorAll("style, link[rel=stylesheet]")) target.head.appendChild(node.cloneNode(true))
    target.body.style.margin = "0"
    window.__detachedDocument = target
    setDoc(target)
  }, [])

  return (
    <>
      <iframe ref={frame} title="Detached window" className="absolute left-6 top-24 h-72 w-96 rounded-lg border border-border bg-background" />
      {doc && createPortal(
        <UiEnvironmentProvider document={doc}>
          <Expose name="__detached" />
          <Toaster />
          <p className="p-4 text-sm text-muted-foreground">Detached window</p>
        </UiEnvironmentProvider>,
        doc.body,
      )}
    </>
  )
}

// The old wiring on purpose: a provider at the root (RedLeaf App.tsx), the shell's toaster,
// a plugin that wraps itself in its own provider, and a stray second <Toaster />.
function Story() {
  return (
    <ToastProvider>
      <Toaster />
      <div className="relative h-full p-6">
        <h1 className="text-lg font-semibold">Toast story</h1>
        <div data-story-scope="plugin" className="absolute inset-x-6 bottom-24 top-[22rem] rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
          <ToastProvider>
            Plugin scope
            <Expose name="__plugin" />
            <Toaster />
          </ToastProvider>
        </div>
        <DetachedWindow />
      </div>
    </ToastProvider>
  )
}

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Story />
  </React.StrictMode>,
)
