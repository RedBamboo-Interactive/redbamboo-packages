import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@redbamboo/ui"
import { SUITE_APPS } from "@redbamboo/utility"
import type { ImageAttachment } from "../types"

// ── App metadata (from the shared suite registry) ────────────────────

interface AppMeta {
  icon: string
  color: string
  label: string
}

function resolveApp(name: string): AppMeta {
  const key = name.toLowerCase().replace(/\s+/g, "")
  const app = SUITE_APPS.find((a) => a.name.toLowerCase() === key)
  return app
    ? { icon: app.icon, color: app.color, label: app.name }
    : { icon: "ph-bold ph-circle", color: "var(--color-text-muted)", label: name }
}

// ── Types ────────────────────────────────────────────────────────────

export interface ContextCardData {
  app: string
  url: string
  title?: string
  description?: string
  selection?: string
  screenshot?: ImageAttachment
  route?: string
  extra?: Record<string, unknown>
}

export interface ContextSquareProps {
  context: ContextCardData
  rawXml?: string
}

export interface PendingContextBannerProps {
  context: ContextCardData
  onDismiss: () => void
}

// ── ContextSquare (small indicator in message, opens modal) ──────────

export function ContextSquare({ context, rawXml }: ContextSquareProps) {
  const [open, setOpen] = useState(false)
  const app = resolveApp(context.app)

  const NOVA_MAGENTA = "rgb(236 72 153)"

  return (
    <div className="py-1.5 px-0.5 flex justify-end">
      <button
        onClick={() => setOpen(true)}
        className="w-2.5 h-2.5 rounded-[2px] transition-all duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer square-spawn"
        style={{ backgroundColor: NOVA_MAGENTA }}
        title={`Context from ${app.label}`}
      />

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: NOVA_MAGENTA }} />
            <i className={`${app.icon} text-sm`} style={{ color: app.color }} />
            <DialogTitle className="text-sm">Context from {app.label}</DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto p-4 flex-1 min-h-0 space-y-3">
            {context.screenshot && (
              <img
                src={`data:${context.screenshot.mediaType};base64,${context.screenshot.base64}`}
                alt={`Screenshot from ${app.label}`}
                className="max-h-48 rounded-md border border-overlay-10 object-cover object-top"
              />
            )}
            <pre className="text-xs font-mono whitespace-pre-wrap break-all text-text-secondary bg-overlay-4 rounded-md px-3 py-2.5 leading-relaxed">
              {rawXml || formatContextBlock(context)}
            </pre>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── PendingContextBanner (renders above composer before send) ────────

export function PendingContextBanner({ context, onDismiss }: PendingContextBannerProps) {
  const app = resolveApp(context.app)
  const displayUrl = context.route || tryPathname(context.url) || context.url
  const breadcrumbs = context.extra?.breadcrumbs as string | undefined

  return (
    <div
      data-slot="pending-context-banner"
      className="mx-3 mb-1 rounded-lg border px-3 py-2 flex items-center gap-3"
      style={{
        borderColor: `color-mix(in oklch, ${app.color}, transparent 70%)`,
        backgroundColor: `color-mix(in oklch, ${app.color}, transparent 92%)`,
      }}
    >
      {context.screenshot && (
        <img
          src={`data:${context.screenshot.mediaType};base64,${context.screenshot.base64}`}
          alt=""
          className="w-12 h-12 object-cover object-top rounded border border-overlay-10 shrink-0"
        />
      )}

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <i className={`${app.icon} text-[10px]`} style={{ color: app.color }} />
          <span className="text-xs font-medium" style={{ color: app.color }}>{app.label}</span>
          <span className="text-[10px] text-text-muted font-mono truncate">{displayUrl}</span>
        </div>
        {breadcrumbs && (
          <p className="text-[10px] text-text-muted truncate mt-0.5">{breadcrumbs}</p>
        )}
        {!breadcrumbs && context.title && (
          <p className="text-xs text-text-secondary truncate mt-0.5">{context.title}</p>
        )}
        {context.selection && (
          <p className="text-[10px] text-text-muted truncate mt-0.5 italic">"{context.selection}"</p>
        )}
      </div>

      <button
        onClick={onDismiss}
        className="w-6 h-6 flex items-center justify-center rounded hover:bg-overlay-10 text-text-muted hover:text-text-primary transition-colors shrink-0"
        title="Dismiss context"
      >
        <i className="ph-bold ph-x text-xs" />
      </button>
    </div>
  )
}

// ── Parsing: extract ContextCardData from a user message ─────────────

export function parseContextFromMessage(content: string): ContextCardData | null {
  const match = content.match(/<nova-context\s+source="[^"]*"[^>]*>([\s\S]*?)<\/nova-context>/)
  if (!match) return null

  const inner = match[1]

  const get = (tag: string): string | undefined => {
    const m = inner.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
    return m?.[1]?.trim() || undefined
  }

  const app = get("app")
  const url = get("url")
  if (!app || !url) return null

  const extra: Record<string, unknown> = {}
  const knownTags = new Set(["app", "url", "page-title", "route", "description", "selected-text", "has-screenshot"])
  const tagPattern = /<([a-zA-Z][a-zA-Z0-9_-]*)>([\s\S]*?)<\/\1>/g
  let tagMatch: RegExpExecArray | null
  while ((tagMatch = tagPattern.exec(inner)) !== null) {
    if (!knownTags.has(tagMatch[1])) {
      extra[tagMatch[1]] = tagMatch[2].trim()
    }
  }

  return {
    app,
    url,
    title: get("page-title"),
    route: get("route"),
    description: get("description"),
    selection: get("selected-text"),
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  }
}

export function extractRawContextXml(content: string): string | undefined {
  const match = content.match(/<nova-context\s+source="[^"]*"[^>]*>[\s\S]*?<\/nova-context>/)
  return match?.[0]
}

// ── Helpers ──────────────────────────────────────────────────────────

function formatContextBlock(context: ContextCardData): string {
  const lines: string[] = []
  lines.push(`app: ${context.app}`)
  lines.push(`url: ${context.url}`)
  if (context.route) lines.push(`route: ${context.route}`)
  if (context.title) lines.push(`page: ${context.title}`)
  if (context.description) lines.push(`description: ${context.description}`)
  if (context.selection) lines.push(`selection: ${context.selection}`)
  if (context.extra) {
    for (const [key, value] of Object.entries(context.extra)) {
      lines.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`)
    }
  }
  return lines.join("\n")
}

function tryPathname(url: string): string | undefined {
  try {
    const u = new URL(url)
    const path = u.pathname + u.search
    return path === "/" ? undefined : path
  } catch {
    return undefined
  }
}
