import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@redbamboo/ui"
import type { ImageAttachment } from "../types"

// ── App metadata (mirrors utility/app-switcher registry) ─────────────

interface AppMeta {
  icon: string
  color: string
  label: string
}

const APP_META: Record<string, AppMeta> = {
  redcompute: { icon: "fa-solid fa-microchip", color: "#26A69A", label: "RedCompute" },
  codered:    { icon: "fa-solid fa-terminal",  color: "#E55B5B", label: "CodeRed" },
  redmatter:  { icon: "fa-solid fa-fire",      color: "#D4A03C", label: "RedMatter" },
  nova:       { icon: "fa-solid fa-star",       color: "#C74B7A", label: "Nova" },
  redleaf:    { icon: "fa-solid fa-leaf",        color: "#66BB6A", label: "RedLeaf" },
}

function resolveApp(name: string): AppMeta {
  const key = name.toLowerCase().replace(/\s+/g, "")
  return APP_META[key] ?? { icon: "fa-solid fa-circle", color: "var(--color-text-muted)", label: name }
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

export interface ContextCardProps {
  context: ContextCardData
}

export interface PendingContextBannerProps {
  context: ContextCardData
  onDismiss: () => void
}

// ── ContextCard (renders in message history) ─────────────────────────

export function ContextCard({ context }: ContextCardProps) {
  const [screenshotOpen, setScreenshotOpen] = useState(false)
  const app = resolveApp(context.app)
  const displayUrl = context.route || tryPathname(context.url) || context.url

  return (
    <>
      <div
        data-slot="context-card"
        className="my-3 rounded-lg border p-3"
        style={{
          borderColor: `color-mix(in oklch, ${app.color}, transparent 70%)`,
          backgroundColor: `color-mix(in oklch, ${app.color}, transparent 92%)`,
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-5 h-5 rounded flex items-center justify-center"
            style={{ backgroundColor: `color-mix(in oklch, ${app.color}, transparent 75%)` }}
          >
            <i className={`${app.icon} text-[10px]`} style={{ color: app.color }} />
          </div>
          <span className="text-sm font-medium" style={{ color: app.color }}>
            {app.label}
          </span>
          <span className="text-xs text-text-muted font-mono truncate max-w-[60%]">
            {displayUrl}
          </span>
        </div>

        {context.screenshot && (
          <button
            onClick={() => setScreenshotOpen(true)}
            className="block w-full mb-2 cursor-pointer group"
          >
            <img
              src={`data:${context.screenshot.mediaType};base64,${context.screenshot.base64}`}
              alt={`Screenshot from ${app.label}`}
              className="w-full max-h-48 object-cover object-top rounded-md border border-overlay-10 group-hover:brightness-110 transition-all"
            />
          </button>
        )}

        {context.title && (
          <p className="text-sm font-medium text-text-primary mb-1">{context.title}</p>
        )}

        {context.description && (
          <p className="text-xs text-text-muted mb-1">{context.description}</p>
        )}

        {context.selection && (
          <div className="mt-2 rounded-md bg-overlay-6 px-3 py-2 border-l-2" style={{ borderLeftColor: app.color }}>
            <p className="text-[10px] uppercase text-text-disabled font-semibold mb-1">Selected text</p>
            <p className="text-xs text-text-secondary font-serif whitespace-pre-wrap line-clamp-4">{context.selection}</p>
          </div>
        )}

        {context.extra && Object.keys(context.extra).length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {Object.entries(context.extra).map(([key, value]) => (
              <span
                key={key}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-disabled"
              >
                {key}: {typeof value === "string" ? value : JSON.stringify(value)}
              </span>
            ))}
          </div>
        )}
      </div>

      {context.screenshot && (
        <Dialog open={screenshotOpen} onOpenChange={v => { if (!v) setScreenshotOpen(false) }}>
          <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 gap-0">
            <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
              <div
                className="w-3 h-3 rounded-[2px]"
                style={{ backgroundColor: app.color }}
              />
              <i className={`${app.icon} text-sm`} style={{ color: app.color }} />
              <DialogTitle className="text-sm">{app.label} — {displayUrl}</DialogTitle>
            </DialogHeader>
            <div className="overflow-auto p-2 flex-1 min-h-0">
              <img
                src={`data:${context.screenshot.mediaType};base64,${context.screenshot.base64}`}
                alt={`Screenshot from ${app.label}`}
                className="w-full rounded"
              />
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  )
}

// ── PendingContextBanner (renders above composer before send) ────────

export function PendingContextBanner({ context, onDismiss }: PendingContextBannerProps) {
  const app = resolveApp(context.app)
  const displayUrl = context.route || tryPathname(context.url) || context.url

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
        {context.title && (
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
        <i className="fa-solid fa-xmark text-xs" />
      </button>
    </div>
  )
}

// ── Parsing: extract ContextCardData from a user message ─────────────

export function parseContextFromMessage(content: string): ContextCardData | null {
  const match = content.match(/<nova-context[\s\S]*?>([\s\S]*?)<\/nova-context>/)
  if (!match) return null

  const inner = match[1]

  const get = (tag: string): string | undefined => {
    const m = inner.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))
    return m?.[1]?.trim() || undefined
  }

  const app = get("app")
  const url = get("url")
  if (!app || !url) return null

  return {
    app,
    url,
    title: get("page-title"),
    route: get("route"),
    description: get("description"),
    selection: get("selected-text"),
  }
}

// ── Utility ──────────────────────────────────────────────────────────

function tryPathname(url: string): string | undefined {
  try {
    const u = new URL(url)
    const path = u.pathname + u.search
    return path === "/" ? undefined : path
  } catch {
    return undefined
  }
}
