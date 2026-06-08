import { useState, useEffect, useCallback, useRef } from "react"

// ── Types ────────────────────────────────────────────────────────────

export interface AskNovaImageAttachment {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  base64: string
}

export interface AskNovaContext {
  app: string
  url: string
  title?: string
  description?: string
  selection?: string
  screenshot?: AskNovaImageAttachment
  route?: string
  extra?: Record<string, unknown>
}

export interface AskNovaOptions {
  captureScreenshot?: () => Promise<AskNovaImageAttachment | undefined>
  novaPort?: number
}

export interface UseAskNovaReceiverOptions {
  onContext: (context: AskNovaContext) => void
  enabled?: boolean
}

// ── Protocol ─────────────────────────────────────────────────────────

const NOVA_PORT = 18803
const PROTOCOL_TYPE = "redbamboo:ask-nova"
const PROTOCOL_READY = "redbamboo:ask-nova:ready"
const READY_POLL_INTERVAL = 300
const READY_POLL_MAX = 30

interface AskNovaMessage {
  type: typeof PROTOCOL_TYPE
  context: AskNovaContext
}

interface ReadyMessage {
  type: typeof PROTOCOL_READY
}

// ── Format context for AI ────────────────────────────────────────────

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function formatContextMessage(context: AskNovaContext, userQuestion?: string): string {
  const lines: string[] = []

  lines.push(`<nova-context source="${escapeXml(context.app)}">`)
  lines.push(`<app>${escapeXml(context.app)}</app>`)
  lines.push(`<url>${escapeXml(context.url)}</url>`)
  if (context.title) lines.push(`<page-title>${escapeXml(context.title)}</page-title>`)
  if (context.route) lines.push(`<route>${escapeXml(context.route)}</route>`)
  if (context.description) lines.push(`<description>${escapeXml(context.description)}</description>`)
  if (context.selection) lines.push(`<selected-text>${escapeXml(context.selection)}</selected-text>`)
  if (context.extra) {
    const safeEntries = Object.entries(context.extra).filter(([key]) => /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(key))
    for (const [key, value] of safeEntries) {
      const text = typeof value === "string" ? escapeXml(value) : escapeXml(JSON.stringify(value))
      lines.push(`<${key}>${text}</${key}>`)
    }
  }
  if (context.screenshot) lines.push(`<has-screenshot>true</has-screenshot>`)
  lines.push(`</nova-context>`)

  if (userQuestion) lines.push(userQuestion)

  return lines.join("\n")
}

// ── Core: open Nova and transfer context ─────────────────────────────

export async function askNova(
  context: AskNovaContext,
  options: AskNovaOptions = {},
): Promise<boolean> {
  const { captureScreenshot, novaPort = NOVA_PORT } = options

  let fullContext = context
  if (captureScreenshot && !context.screenshot) {
    const screenshot = await captureScreenshot()
    if (screenshot) fullContext = { ...context, screenshot }
  }

  const hostname = window.location.hostname || "localhost"
  const protocol = window.location.protocol
  const novaOrigin = `${protocol}//${hostname}:${novaPort}`

  const novaWindow = window.open(novaOrigin, "nova-ai")
  if (!novaWindow) return false

  const payload: AskNovaMessage = { type: PROTOCOL_TYPE, context: fullContext }

  return new Promise<boolean>((resolve) => {
    let done = false

    function send() {
      if (done) return
      done = true
      cleanup()
      novaWindow!.postMessage(payload, novaOrigin)
      resolve(true)
    }

    function onMessage(event: MessageEvent) {
      if (event.origin !== novaOrigin) return
      if ((event.data as ReadyMessage | undefined)?.type !== PROTOCOL_READY) return
      send()
    }

    function cleanup() {
      window.removeEventListener("message", onMessage)
      clearInterval(poll)
    }

    window.addEventListener("message", onMessage)

    // Poll for already-open tabs: try posting immediately and on an
    // interval. The receiver ignores duplicates via a processed-id set.
    let attempts = 0
    const poll = setInterval(() => {
      if (done || ++attempts > READY_POLL_MAX) {
        if (!done) send()
        return
      }
      try {
        novaWindow!.postMessage(payload, novaOrigin)
      } catch { /* cross-origin during navigation — ignore */ }
    }, READY_POLL_INTERVAL)
  })
}

// ── Hook: receiver side (used by Nova) ───────────────────────────────

export function useAskNovaReceiver({ onContext, enabled = true }: UseAskNovaReceiverOptions): void {
  const callbackRef = useRef(onContext)
  callbackRef.current = onContext
  const processedRef = useRef(new Set<string>())

  useEffect(() => {
    if (!enabled) return

    const hostname = window.location.hostname || "localhost"
    const protocol = window.location.protocol
    const allowedOrigins = new Set(
      [18800, 18801, 18802, 18803, 18804].map(p => `${protocol}//${hostname}:${p}`),
    )

    function sendReady() {
      if (!window.opener) return
      try {
        (window.opener as Window).postMessage(
          { type: PROTOCOL_READY } satisfies ReadyMessage,
          "*",
        )
      } catch { /* opener may be cross-origin or closed */ }
    }

    sendReady()

    function onMessage(event: MessageEvent) {
      if (!allowedOrigins.has(event.origin)) return
      const data = event.data as AskNovaMessage | undefined
      if (data?.type !== PROTOCOL_TYPE) return

      const dedupeKey = `${data.context.app}:${data.context.url}:${data.context.title ?? ""}`
      if (processedRef.current.has(dedupeKey)) return
      processedRef.current.add(dedupeKey)
      setTimeout(() => processedRef.current.delete(dedupeKey), 5000)

      callbackRef.current(data.context)
    }

    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [enabled])
}

// ── Hook: pending context (used by Nova to hold context until send) ──

export interface PendingNovaContext {
  context: AskNovaContext | null
  set: (ctx: AskNovaContext) => void
  clear: () => void
  wrapMessage: (text: string, images?: AskNovaImageAttachment[]) => {
    text: string
    images?: AskNovaImageAttachment[]
  }
}

export function usePendingNovaContext(): PendingNovaContext {
  const [context, setContext] = useState<AskNovaContext | null>(null)

  const set = useCallback((ctx: AskNovaContext) => setContext(ctx), [])
  const clear = useCallback(() => setContext(null), [])

  const wrapMessage = useCallback(
    (text: string, images?: AskNovaImageAttachment[]) => {
      if (!context) return { text, images }

      const wrappedText = formatContextMessage(context, text)
      const wrappedImages = context.screenshot
        ? [context.screenshot, ...(images ?? [])]
        : images

      return { text: wrappedText, images: wrappedImages }
    },
    [context],
  )

  return { context, set, clear, wrapMessage }
}

// ── Hook: sender side (used by source apps) ──────────────────────────

export interface UseAskNovaOptions {
  app: string
  captureScreenshot?: () => Promise<AskNovaImageAttachment | undefined>
  novaPort?: number
  enabled?: boolean
}

export interface UseAskNovaReturn {
  ask: (overrides?: Partial<AskNovaContext>) => Promise<boolean>
  askWithSelection: () => Promise<boolean>
}

export function useAskNova({
  app,
  captureScreenshot,
  novaPort,
  enabled = true,
}: UseAskNovaOptions): UseAskNovaReturn {
  const captureRef = useRef(captureScreenshot)
  captureRef.current = captureScreenshot

  const ask = useCallback(async (overrides?: Partial<AskNovaContext>) => {
    if (!enabled) return false

    const context: AskNovaContext = {
      app,
      url: window.location.href,
      title: document.title,
      route: window.location.pathname + window.location.search,
      selection: window.getSelection()?.toString()?.trim() || undefined,
      ...overrides,
    }

    return askNova(context, { captureScreenshot: captureRef.current, novaPort })
  }, [app, novaPort, enabled])

  const askWithSelection = useCallback(async () => {
    const selection = window.getSelection()?.toString()?.trim()
    return ask({ selection: selection || undefined })
  }, [ask])

  return { ask, askWithSelection }
}

// ── Hook: command palette registration ───────────────────────────────

export interface UseAskNovaCommandOptions extends UseAskNovaOptions {
  shortcut?: string
  store?: {
    register(command: {
      id: string
      label: string
      group?: string
      shortcut?: string
      keywords?: string[]
      action: () => void | Promise<void>
    }): void
    unregister(id: string): void
  }
}

export function useAskNovaCommand({
  store,
  shortcut = "Ctrl+Shift+N",
  ...askOptions
}: UseAskNovaCommandOptions): UseAskNovaReturn {
  const nova = useAskNova(askOptions)
  const novaRef = useRef(nova)
  novaRef.current = nova

  useEffect(() => {
    if (!store || askOptions.enabled === false) return

    store.register({
      id: "ask-nova",
      label: "Ask Nova about this page",
      group: "AI",
      shortcut,
      keywords: ["nova", "ai", "ask", "question", "help", "screenshot", "context"],
      action: () => { novaRef.current.ask() },
    })

    store.register({
      id: "ask-nova-selection",
      label: "Ask Nova about selection",
      group: "AI",
      keywords: ["nova", "ai", "selection", "highlight", "text"],
      action: () => { novaRef.current.askWithSelection() },
    })

    return () => {
      store.unregister("ask-nova")
      store.unregister("ask-nova-selection")
    }
  }, [store, shortcut, askOptions.enabled])

  return nova
}
