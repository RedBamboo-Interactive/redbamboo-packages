import { useState } from "react"
import type { MessageBlock, SessionStats, SessionConfigOption, SessionAgentInfo } from "../types"
import {
  Button,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  Icon,
  buttonVariants,
} from "@redbamboo/ui"
import { MorphSpinner } from "./morph-spinner"
import { getSessionResourceHref, type SessionResourceKind } from "../lib/session-resource-links"

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  stats: SessionStats | null
  messages: MessageBlock[]
  agent?: SessionAgentInfo | null
  modelOptions?: SessionConfigOption[]
  effortOptions?: SessionConfigOption[]
  qualityTierOptions?: SessionConfigOption[]
  providerOptions?: SessionConfigOption[]
  onConfigChange?: (config: { model?: string; effort?: string; qualityTier?: string }) => Promise<void>
  children?: React.ReactNode
}

const DEFAULT_MAX_CONTEXT = 200_000

// contextWindow is resolved server-side, where a quality mode's declared window outranks
// whatever the inference runtime reported. Nothing left to infer from the model name here.
export function getMaxContext(stats: SessionStats): number {
  return stats.contextWindow || DEFAULT_MAX_CONTEXT
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
  if (cost == null) return "--"
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

const RESOURCE_DESTINATIONS: Record<SessionResourceKind, string> = {
  job: "Compute job",
  session: "CodeRed session",
  discussion: "Nova discussion",
}

function IdentifierRow({ label, value, kind }: { label: string; value: string; kind: SessionResourceKind }) {
  const [copied, setCopied] = useState(false)
  const destination = RESOURCE_DESTINATIONS[kind]

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be denied by the browser. Leave the action in its
      // neutral state instead of claiming the value was copied.
    }
  }

  return (
    <div className="flex items-center justify-between py-1.5 gap-3">
      <span className="text-xs text-text-muted shrink-0">{label}</span>
      <div className="flex items-center gap-1 min-w-0">
        <code
          className="min-w-0 max-w-28 truncate font-mono text-[11px] leading-6 px-2 rounded-md bg-overlay-6 text-text-muted"
          title={value}
        >
          #{value.slice(0, 8)}
        </code>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          onClick={handleCopy}
          className={copied ? "text-accent-teal" : "text-text-muted"}
          aria-label={copied ? `${label} copied` : `Copy ${label}`}
          title={copied ? "Copied" : `Copy ${label}`}
        >
          <i aria-hidden="true" className={`ph-bold ${copied ? "ph-check" : "ph-copy"} text-xs`} />
        </Button>
        <a
          href={getSessionResourceHref(kind, value)}
          className={buttonVariants({ variant: "ghost", size: "icon-xs", className: "text-text-muted" })}
          aria-label={`Open ${destination}`}
          title={`Open ${destination}`}
        >
          <i aria-hidden="true" className="ph-bold ph-arrow-square-out text-xs" />
        </a>
      </div>
    </div>
  )
}

function StatRow({ label, value, sub, mono }: { label: string; value: string; sub?: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1.5 gap-3 min-w-0">
      <span className="text-xs text-text-muted shrink-0">{label}</span>
      <span className={`text-sm font-medium text-right min-w-0 truncate ${mono ? "font-mono text-xs" : ""}`}>
        {value}
        {sub && <span className="text-xs text-text-muted ml-1">{sub}</span>}
      </span>
    </div>
  )
}

function EntityStatRow({ label, value, option }: { label: string; value: string; option?: SessionConfigOption }) {
  return (
    <div className="flex items-center justify-between py-1.5 gap-3 min-w-0">
      <span className="text-xs text-text-muted shrink-0">{label}</span>
      <span
        className="inline-flex items-center gap-1.5 text-sm font-medium text-right min-w-0 truncate"
        style={option?.color ? { color: option.color } : undefined}
      >
        {(option?.icon || option?.iconSvgPath) && (
          <Icon name={option.icon} svgPath={option.iconSvgPath} className="size-4 shrink-0" />
        )}
        <span className="truncate">{option?.label ?? value}</span>
      </span>
    </div>
  )
}

function AgentEntityCard({ agent }: { agent: SessionAgentInfo }) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null)
  const showAvatar = !!agent.avatarUrl && failedAvatarUrl !== agent.avatarUrl

  return (
    <div
      className="flex items-center gap-3 rounded-lg border border-overlay-6 bg-overlay-3 px-3 py-2.5"
      title={agent.id}
    >
      {showAvatar ? (
        <img
          src={agent.avatarUrl!}
          alt=""
          className="size-9 shrink-0 rounded-full object-cover"
          onError={() => setFailedAvatarUrl(agent.avatarUrl ?? null)}
        />
      ) : (
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-overlay-10 text-text-muted">
          <span aria-hidden="true" className="text-sm font-medium">{agent.name[0]?.toUpperCase() ?? "?"}</span>
        </span>
      )}
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-contrast">{agent.name}</div>
        <div className="text-[11px] text-text-muted">Agent</div>
      </div>
    </div>
  )
}

function findOption(options: SessionConfigOption[] | undefined, value: string | null | undefined) {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  return options?.find(option =>
    option.value.toLowerCase() === normalized
    || option.aliases?.some(alias => alias.toLowerCase() === normalized))
}

function ConfigSelect({ label, value, options, onChange, disabled }: {
  label: string
  value: string
  options: SessionConfigOption[]
  onChange: (value: string) => void
  disabled?: boolean
}) {
  const hasIcons = options.some(o => o.icon || o.iconSvgPath || o.color)

  if (hasIcons) {
    return (
      <div className="flex items-center justify-between py-1.5">
        <span className="text-xs text-text-muted">{label}</span>
        <div className="flex items-center gap-1">
          {options.map(o => {
            const active = value === o.value
            return (
              <button
                key={o.value}
                onClick={() => !disabled && onChange(o.value)}
                disabled={disabled}
                title={o.label}
                className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md transition-colors disabled:opacity-50 ${
                  active ? "" : "bg-overlay-6 text-text-muted hover:bg-overlay-10 hover:text-contrast"
                }`}
                style={active && o.color ? { backgroundColor: `${o.color}20`, color: o.color } : undefined}
              >
                {(o.icon || o.iconSvgPath) && <Icon name={o.icon} svgPath={o.iconSvgPath} className="size-3.5" />}
                {o.label}
              </button>
            )
          })}
        </div>
      </div>
    )
  }

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

export function SessionStatsModal({ open, onOpenChange, stats, messages, agent, modelOptions, effortOptions, qualityTierOptions, providerOptions, onConfigChange, children }: Props) {
  const s = stats ?? {} as SessionStats
  const maxContext = getMaxContext(s)
  const pct = getContextPercent(s)
  const toolCalls = countToolCalls(messages)
  const userMessages = messages.filter(m => m.role === "user").length
  const [updating, setUpdating] = useState(false)
  const providerValue = s.providerEntity ?? s.provider
  const providerOption = findOption(providerOptions, providerValue)
  const qualityTierOption = findOption(qualityTierOptions, s.qualityTier)

  const hasConfig = onConfigChange && (modelOptions || effortOptions || qualityTierOptions)

  const handleConfigChange = async (config: { model?: string; effort?: string; qualityTier?: string }) => {
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

        {agent && <AgentEntityCard agent={agent} />}

        {children}

        <div className="divide-y divide-overlay-6 min-w-0">
          {(s.name || s.jobHash || s.sessionId || s.discussionId) && (
            <div className="pb-2">
              {s.name && <StatRow label="Name" value={s.name} />}
              {s.jobHash && <IdentifierRow label="Job hash" value={s.jobHash} kind="job" />}
              {s.sessionId && <IdentifierRow label="Session ID" value={s.sessionId} kind="session" />}
              {s.discussionId && <IdentifierRow label="Discussion ID" value={s.discussionId} kind="discussion" />}
            </div>
          )}

          {hasConfig && (
            <div className="pb-2">
              {providerValue && (
                <EntityStatRow label="Provider" value={providerValue} option={providerOption} />
              )}
              {modelOptions && (
                <ConfigSelect
                  label="Model"
                  value={currentModelAlias(s.model)}
                  options={modelOptions}
                  onChange={v => handleConfigChange({ model: v })}
                  disabled={updating}
                />
              )}
              {qualityTierOptions && (
                <ConfigSelect
                  label="Quality"
                  value={s.qualityTier || ""}
                  options={qualityTierOptions}
                  onChange={v => handleConfigChange({ qualityTier: v })}
                  disabled={updating}
                />
              )}
              {effortOptions && !qualityTierOptions && (
                <ConfigSelect
                  label="Quality"
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
            {!hasConfig && providerValue && (
              <EntityStatRow label="Provider" value={providerValue} option={providerOption} />
            )}
            {s.qualityTier && !(onConfigChange && qualityTierOptions) && (
              <EntityStatRow label="Quality" value={s.qualityTier} option={qualityTierOption} />
            )}
            <StatRow label="Model" value={shortModel(s.model)} />
            <StatRow label={s.costEstimated ? "Est. standard API cost" : "Cost"} value={formatCost(s.costUsd)} />
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
