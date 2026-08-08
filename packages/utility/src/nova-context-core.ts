export interface ContextImageAttachment {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  base64: string
}

export interface VisibleAppContext {
  app: string
  appId?: string
  url: string
  title?: string
  description?: string
  selection?: string
  screenshot?: ContextImageAttachment
  route?: string
  extra?: Record<string, unknown>
}

export interface VisibleAppContextCaptureResult {
  context: VisibleAppContext
  screenshotStatus: "captured" | "unavailable"
}

export interface CaptureVisibleAppContextOptions {
  sourceWindow?: Window
  sourceDocument?: Document
  captureScreenshot?: (sourceDocument: Document, sourceWindow: Window) => Promise<ContextImageAttachment | undefined>
}

export class VisibleAppContextCaptureError extends Error {
  readonly code: "source_unavailable" | "source_changed"

  constructor(code: "source_unavailable" | "source_changed", message: string) {
    super(message)
    this.name = "VisibleAppContextCaptureError"
    this.code = code
  }
}

export interface ActiveAppIdentity {
  id?: string
  name: string
}

export function resolveActiveAppIdentity(sourceDocument: Document): ActiveAppIdentity {
  const shell = sourceDocument.querySelector<HTMLElement>('[data-slot="app-shell"]')
  const id = shell?.dataset.activeAppId || undefined
  const name = shell?.dataset.activeAppName?.trim()
    || id
    || sourceDocument.title.trim()
    || "RedLeaf"
  return { id, name }
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

export function formatContextMessage(context: VisibleAppContext, userText?: string): string {
  const lines: string[] = []

  lines.push(`<nova-context source="${escapeXml(context.app)}">`)
  lines.push(`<app>${escapeXml(context.app)}</app>`)
  if (context.appId) lines.push(`<app-id>${escapeXml(context.appId)}</app-id>`)
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
  if (context.screenshot) lines.push("<has-screenshot>true</has-screenshot>")
  lines.push("</nova-context>")

  if (userText) lines.push(userText)
  return lines.join("\n")
}

export function assertSourceUrlUnchanged(expectedUrl: string, actualUrl: string): void {
  if (actualUrl !== expectedUrl) {
    throw new VisibleAppContextCaptureError("source_changed", "The foreground app changed while context was being captured.")
  }
}
