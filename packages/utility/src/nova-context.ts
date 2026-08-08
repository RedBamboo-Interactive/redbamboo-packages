import { queryEntityCards } from "@redbamboo/ui"
import {
  assertSourceUrlUnchanged,
  resolveActiveAppIdentity,
  VisibleAppContextCaptureError,
  type CaptureVisibleAppContextOptions,
  type ContextImageAttachment,
  type VisibleAppContextCaptureResult,
} from "./nova-context-core"

export {
  assertSourceUrlUnchanged,
  formatContextMessage,
  resolveActiveAppIdentity,
  VisibleAppContextCaptureError,
} from "./nova-context-core"
export type {
  ActiveAppIdentity,
  CaptureVisibleAppContextOptions,
  ContextImageAttachment,
  VisibleAppContext,
  VisibleAppContextCaptureResult,
} from "./nova-context-core"

export function scrapeDOMContext(sourceDocument: Document = document): Record<string, unknown> {
  const ctx: Record<string, unknown> = {}

  const crumbs = sourceDocument.querySelectorAll<HTMLElement>('[data-slot="breadcrumb"] .truncate')
  if (crumbs.length > 0) {
    ctx.breadcrumbs = Array.from(crumbs).map(el => el.textContent?.trim()).filter(Boolean).join(" > ")
  }

  const activeTab = sourceDocument.querySelector<HTMLElement>('[data-slot="tabs-trigger"][data-active]')
  if (activeTab) ctx.activeTab = activeTab.textContent?.trim() || undefined

  const selectedItem = sourceDocument.querySelector<HTMLElement>('[data-slot="item-list-row"][data-selected]')
  if (selectedItem) ctx.selectedItem = selectedItem.textContent?.trim()?.replace(/\s+/g, " ") || undefined

  const entityCards = queryEntityCards(sourceDocument).filter(card => card.visible)
  const currentEntity = entityCards.find(card => card.focused)
    ?? entityCards.find(card => card.current)
    ?? entityCards.find(card => card.selected)
  if (currentEntity) {
    ctx.currentEntity = {
      id: currentEntity.id,
      typeSlug: currentEntity.typeSlug,
      name: currentEntity.name,
      href: currentEntity.href,
    }
  }

  const selectedEntities = entityCards
    .filter(card => card.selected && card !== currentEntity)
    .slice(0, 5)
    .map(card => ({
      id: card.id,
      typeSlug: card.typeSlug,
      name: card.name,
      href: card.href,
    }))
  if (selectedEntities.length > 0) ctx.selectedEntities = selectedEntities

  const heading = sourceDocument.querySelector<HTMLElement>("h1, h2")
  if (heading) ctx.heading = heading.textContent?.trim() || undefined

  return ctx
}

async function captureViewportScreenshot(sourceDocument: Document, sourceWindow: Window): Promise<ContextImageAttachment | undefined> {
  const { toPng } = await import("html-to-image")
  const HTMLElementCtor = sourceDocument.defaultView?.HTMLElement
  const width = Math.max(1, sourceWindow.innerWidth)
  const dataUrl = await toPng(sourceDocument.body, {
    pixelRatio: Math.min(1, 1280 / width),
    height: sourceWindow.innerHeight,
    canvasHeight: sourceWindow.innerHeight,
    filter: (node) => !(HTMLElementCtor && node instanceof HTMLElementCtor
      && (node.hasAttribute("data-radix-portal") || node.hasAttribute("data-base-ui-portal"))),
  })
  const base64 = dataUrl.split(",")[1]
  return base64 ? { mediaType: "image/png", base64 } : undefined
}

export async function captureVisibleAppContext({
  sourceWindow = typeof window === "undefined" ? undefined : window,
  sourceDocument = typeof document === "undefined" ? undefined : document,
  captureScreenshot = captureViewportScreenshot,
}: CaptureVisibleAppContextOptions = {}): Promise<VisibleAppContextCaptureResult> {
  if (!sourceWindow || !sourceDocument) {
    throw new VisibleAppContextCaptureError("source_unavailable", "The foreground RedLeaf document is unavailable.")
  }

  const sourceUrl = sourceWindow.location.href
  const identity = resolveActiveAppIdentity(sourceDocument)
  const extra = scrapeDOMContext(sourceDocument)
  const title = sourceDocument.title || undefined
  const route = sourceWindow.location.pathname + sourceWindow.location.search
  const selection = sourceWindow.getSelection()?.toString()?.trim() || undefined
  let screenshot: ContextImageAttachment | undefined
  try {
    screenshot = await captureScreenshot(sourceDocument, sourceWindow)
  } catch {
    screenshot = undefined
  }

  assertSourceUrlUnchanged(sourceUrl, sourceWindow.location.href)

  return {
    context: {
      app: identity.name,
      appId: identity.id,
      url: sourceUrl,
      title,
      route,
      selection,
      screenshot,
      extra: Object.keys(extra).length > 0 ? extra : undefined,
    },
    screenshotStatus: screenshot ? "captured" : "unavailable",
  }
}
