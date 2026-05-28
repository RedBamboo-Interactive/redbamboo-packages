import { useState } from "react"
import type { MessageBlock, SessionStats, SessionConfigOption } from "../types"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@redbamboo/ui"
import { MorphSpinner } from "./morph-spinner"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  stats: SessionStats | null
  messages: MessageBlock[]
  modelOptions?: SessionConfigOption[]
  effortOptions?: SessionConfigOption[]
  onConfigChange?: (config: { model?: string; effort?: string }) => Promise<void>
}

const DEFAULT_MAX_CONTEXT = 200_000
const CONTEXT_HINT_RE = /\[(\d+)([km])\]/i

export function getMaxContext(stats: SessionStats): number {
  if (stats.model) {
    const match = stats.model.match(CONTEXT_HINT_RE)
    if (match) {
      const n = parseInt(match[1])
      return n * (match[2].toLowerCase() === "m" ? 1_000_000 : 1_000)
    }
  }
  if (stats.contextWindow) return stats.contextWindow
  return DEFAULT_MAX_CONTEXT
}

function getContextTokens(stats: SessionStats): number {
  return stats.contextTokens || 0
}

export function getContextPercent(stats: SessionStats): number | null {
  const total = getContextTokens(stats)
  if (total === 0) return null
  const max = getMaxContext(stats)
  return Math.min(100, Math.round((total / max) * 100))
}

function formatDuration(startedAt: string): string {
  const ms = Date.now() - new Date(startedAt).getTime()
  const seconds = Math.floor(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  const hours = Math.floor(minutes / 60)
  return `${hours}h ${minutes % 60}m`
}

function formatTokens(n?: number | null): string {
  if (n == null) return "--"
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatCost(cost?: number | null): string {
  if (cost == null) return "$0.00"
  return `$${cost.toFixed(4)}`
}

function shortModel(model?: string | null): string {
  if (!model) return "--"
  return model.replace(/-\d{8}$/, "")
}

function currentModelAlias(model?: string | null): string {
  if (!model) return ""
  const lower = model.toLowerCase()
  if (lower.includes("opus")) return "opus"
  if (lower.includes("haiku")) return "haiku"
  if (lower.includes("sonnet")) return "sonnet"
  return model
}

function countToolCalls(messages: MessageBlock[]): number {
  let count = 0
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool_use") count++
    }
  }
  return count
}

function StatRow({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between py-1.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm font-medium">
        {value}
        {sub && <span className="text-xs text-text-muted ml-1">{sub}</span>}
      </span>
    </div>
  )
}

function ConfigSelect({ label, value, options, onChange, disabled }: {
  label: string
  value: string
  options: SessionConfigOption[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-xs text-text-muted">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="bg-overlay-6 border border-overlay-10 rounded px-2 py-0.5 text-xs text-contrast outline-none focus:border-overlay-20 disabled:opacity-50"
      >
        {options.map(o => (
          <option key={o.value} value={o.value} className="bg-popover text-popover-foreground">{o.label}</option>
        ))}
      </select>
    </div>
  )
}

export function SessionStatsModal({ open, onOpenChange, stats, messages, modelOptions, effortOptions, onConfigChange }: Props) {
  const s = stats ?? {} as SessionStats
  const maxContext = getMaxContext(s)
  const pct = getContextPercent(s)
  const toolCalls = countToolCalls(messages)
  const userMessages = messages.filter(m => m.role === "user").length
  const [updating, setUpdating] = useState(false)

  const hasConfig = onConfigChange && (modelOptions || effortOptions)

  const handleConfigChange = async (config: { model?: string; effort?: string }) => {
    if (!onConfigChange) return
    setUpdating(true)
    try {
      await onConfigChange(config)
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xs">
        <DialogHeader>
          <DialogTitle>Session Info</DialogTitle>
        </DialogHeader>

        <div className="divide-y divide-overlay-6">
          {hasConfig && (
            <div className="pb-2">
              {modelOptions && (
                <ConfigSelect
                  label="Model"
                  value={currentModelAlias(s.model)}
                  options={modelOptions}
                  onChange={v => handleConfigChange({ model: v })}
                  disabled={updating}
                />
              )}
              {effortOptions && (
                <ConfigSelect
                  label="Effort"
                  value={s.effort || "high"}
                  options={effortOptions}
                  onChange={v => handleConfigChange({ effort: v })}
                  disabled={updating}
                />
              )}
              {updating && (
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted mt-1">
                  <MorphSpinner color="var(--muted-foreground)" />
                  <span>Restarting session...</span>
                </div>
              )}
            </div>
          )}

          <div className="py-2">
            <StatRow label="Model" value={shortModel(s.model)} />
            <StatRow label="Cost" value={formatCost(s.costUsd)} />
            {s.startedAt && <StatRow label="Duration" value={formatDuration(s.startedAt)} />}
            {s.status && <StatRow label="Status" value={s.status} />}
          </div>

          <div className="py-2">
            <StatRow label="Messages" value={String(s.messageCount || messages.length)} />
            <StatRow label="User messages" value={String(userMessages)} />
            <StatRow label="Tool calls" value={String(toolCalls)} />
          </div>

          <div className="pt-2">
            <StatRow
              label="Context tokens"
              value={formatTokens(getContextTokens(s) || null)}
              sub={getContextTokens(s) ? `/ ${formatTokens(maxContext)}` : undefined}
            />
            <StatRow label="Output tokens" value={formatTokens(s.outputTokens)} />
            {s.cachedInputTokens != null && (
              <StatRow label="Cached input" value={formatTokens(s.cachedInputTokens)} />
            )}

            {pct != null && (
              <div className="mt-2">
                <div className="flex items-center justify-between text-[10px] text-text-muted mb-1">
                  <span>Context usage</span>
                  <span>{pct}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-overlay-6 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: pct < 60 ? "var(--color-accent-teal)" : pct < 80 ? "var(--color-accent-gold)" : "var(--color-accent-red)",
                    }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
