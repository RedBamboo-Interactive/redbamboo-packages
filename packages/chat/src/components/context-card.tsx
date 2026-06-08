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

export interface ContextSquareProps {
  context: ContextCardData
}

export interface PendingContextBannerProps {
  context: ContextCardData
  onDismiss: () => void
}

// ── ContextSquare (small indicator in message, opens modal) ──────────

export function ContextSquare({ context }: ContextSquareProps) {
  const [open, setOpen] = useState(false)
  const app = resolveApp(context.app)
  const displayUrl = context.route || tryPathname(context.url) || context.url

  return (
    <div className="py-1.5 px-0.5">
      <button
        onClick={() => setOpen(true)}
        className="w-2.5 h-2.5 rounded-[2px] transition-all duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer square-spawn"
        style={{ backgroundColor: app.color }}
        title={`Context from ${app.label}`}
      />

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: app.color }} />
            <i className={`${app.icon} text-sm`} style={{ color: app.color }} />
            <DialogTitle className="text-sm">{app.label}</DialogTitle>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-disabled">
              context
            </span>
          </DialogHeader>

          <div className="overflow-y-auto p-4 flex-1 min-h-0 space-y-3">
            <ContextRow label="URL" value={displayUrl} mono />
            {context.title && <ContextRow label="Page" value={context.title} />}

            {context.extra?.breadcrumbs != null && (
              <ContextRow label="Location" value={String(context.extra.breadcrumbs)} />
            )}
            {context.extra?.activeTab != null && (
              <ContextRow label="Active tab" value={String(context.extra.activeTab)} />
            )}
            {context.extra?.selectedItem != null && (
              <ContextRow label="Selected item" value={String(context.extra.selectedItem)} />
            )}
            {context.extra?.heading != null && (
              <ContextRow label="Heading" value={String(context.extra.heading)} />
            )}

            {context.description && <ContextRow label="Description" value={context.description} />}

            {context.selection && (
              <div>
                <span className="text-[10px] uppercase text-text-disabled font-semibold">Selected text</span>
                <p className="text-xs text-text-secondary font-serif whitespace-pre-wrap mt-1 bg-overlay-4 rounded px-2 py-1.5">
                  {context.selection}
                </p>
              </div>
            )}

            {context.screenshot && (
              <div>
                <span className="text-[10px] uppercase text-text-disabled font-semibold">Screenshot</span>
                <img
                  src={`data:${context.screenshot.mediaType};base64,${context.screenshot.base64}`}
                  alt={`Screenshot from ${app.label}`}
                  className="mt-1 w-full rounded-md border border-overlay-10"
                />
              </div>
            )}

            {/* Remaining extra fields not shown above */}
            {context.extra && (() => {
              const shown = new Set(["breadcrumbs", "activeTab", "selectedItem", "heading"])
              const remaining = Object.entries(context.extra).filter(([k]) => !shown.has(k))
              if (remaining.length === 0) return null
              return (
                <div className="flex flex-wrap gap-1">
                  {remaining.map(([key, value]) => (
                    <span key={key} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-disabled">
                      {key}: {typeof value === "string" ? value : JSON.stringify(value)}
                    </span>
                  ))}
                </div>
              )
            })()}
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

// ── Helpers ──────────────────────────────────────────────────────────

function ContextRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-4 text-xs">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className={`text-text-secondary text-right break-all ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
    </div>
  )
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
