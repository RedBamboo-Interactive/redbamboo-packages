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
  question?: string
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

interface AskNovaMessage {
  type: typeof PROTOCOL_TYPE
  context: AskNovaContext
}

interface ReadyMessage {
  type: typeof PROTOCOL_READY
}

// ── DOM context scraper ──────────────────────────────────────────────

export function scrapeDOMContext(): Record<string, unknown> {
  const ctx: Record<string, unknown> = {}

  const crumbs = document.querySelectorAll<HTMLElement>('[data-slot="breadcrumb"] .truncate')
  if (crumbs.length > 0) {
    ctx.breadcrumbs = Array.from(crumbs).map(el => el.textContent?.trim()).filter(Boolean).join(" > ")
  }

  const activeTab = document.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-active]')
  if (activeTab) {
    ctx.activeTab = activeTab.textContent?.trim() || undefined
  }

  const selectedItem = document.querySelector<HTMLElement>('[data-slot="item-list-row"][data-selected]')
  if (selectedItem) {
    ctx.selectedItem = selectedItem.textContent?.trim()?.replace(/\s+/g, " ") || undefined
  }

  const heading = document.querySelector<HTMLElement>("h1, h2")
  if (heading) {
    ctx.heading = heading.textContent?.trim() || undefined
  }

  return ctx
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

// ── URL hash codec ──────────────────────────────────────────────────

const HASH_PREFIX = "ask-nova="

function encodeContextHash(context: AskNovaContext): string {
  const json = JSON.stringify(context)
  const encoded = encodeURIComponent(json)
  if (encoded.length > 1_500_000) {
    const { screenshot: _, ...lite } = context
    return encodeURIComponent(JSON.stringify(lite))
  }
  return encoded
}

export function parseContextHash(hash: string): AskNovaContext | null {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash
  if (!raw.startsWith(HASH_PREFIX)) return null
  try {
    return JSON.parse(decodeURIComponent(raw.slice(HASH_PREFIX.length)))
  } catch {
    return null
  }
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

  const hash = encodeContextHash(fullContext)
  window.open(`${novaOrigin}/#${HASH_PREFIX}${hash}`, "_blank", "noopener,noreferrer")
  return true
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

    function dedupeAndDeliver(context: AskNovaContext) {
      const key = `${context.app}:${context.url}:${context.title ?? ""}`
      if (processedRef.current.has(key)) return
      processedRef.current.add(key)
      setTimeout(() => processedRef.current.delete(key), 5000)
      callbackRef.current(context)
    }

    // Read context from URL hash (primary path — works with PWA link capturing)
    function checkHash() {
      const ctx = parseContextHash(window.location.hash)
      if (!ctx) return
      history.replaceState(null, "", window.location.pathname + window.location.search)
      dedupeAndDeliver(ctx)
    }

    checkHash()
    window.addEventListener("hashchange", checkHash)

    // postMessage listener (fallback for cross-origin window.open callers)
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
      dedupeAndDeliver(data.context)
    }

    window.addEventListener("message", onMessage)
    return () => {
      window.removeEventListener("hashchange", checkHash)
      window.removeEventListener("message", onMessage)
    }
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

    const domContext = scrapeDOMContext()
    const context: AskNovaContext = {
      app,
      url: window.location.href,
      title: document.title,
      route: window.location.pathname + window.location.search,
      selection: window.getSelection()?.toString()?.trim() || undefined,
      extra: Object.keys(domContext).length > 0 ? domContext : undefined,
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
