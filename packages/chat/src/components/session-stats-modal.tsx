import { useEffect, useMemo, useState } from "react"
import type { AccessLevel, MessageBlock, SessionStats, SessionConfigChange, SessionConfigOption, ProviderUsageSnapshot, SessionInfoButtonProps } from "../types"
import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Icon,
  NodeIcon,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  buttonVariants,
  cn,
} from "@redbamboo/ui"
import { MorphSpinner } from "./morph-spinner"
import {
  Bar, Chip, ContextRing, GlanceTile, InstructionsPanel, MemoryPanel, NodeSection, SectionLabel, SkillsPanel,
  StatTile, Tile, WorkspaceSection, memorySummary, resolveSkills,
} from "./session-info-panels"
import { getSessionResourceHref, type SessionResourceKind } from "../lib/session-resource-links"
import { formatProviderUsageWindow, remainingProviderUsage, usageToneColor } from "../lib/provider-usage"
import { formatProviderEffort } from "../lib/provider-effort"
import { deriveOpenedMemory, deriveUsedSkills } from "../lib/session-info-usage"
import { ACCESS_LEVEL_DESCRIPTIONS, ACCESS_LEVEL_LABELS, accessLevelChoices, isAccessLevel, type AccessLevelChoice } from "../lib/access-level"

interface Props extends Omit<SessionInfoButtonProps, "loadProviderUsage" | "open" | "onOpenChange" | "stats"> {
  open: boolean
  onOpenChange: (open: boolean) => void
  stats: SessionStats | null
  providerUsage?: ProviderUsageSnapshot | null
  providerUsageLoading?: boolean
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
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`
  return n.toLocaleString()
}

function formatCost(cost?: number | null): string {
  if (cost == null) return "--"
  return `$${cost.toFixed(4)}`
}

/** Two decimals once it is a cent or more; a smaller amount keeps its digits. */
function formatCostShort(cost: number): string {
  return cost >= 0.01 ? `$${cost.toFixed(2)}` : `$${cost.toFixed(4)}`
}

function shortModel(model?: string | null): string {
  if (!model) return "--"
  return model.replace(/-\d{8}$/, "")
}

function formatPlan(plan?: string | null): string {
  if (!plan) return "--"
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

function formatReset(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

function ProviderUsageBlock({ usage, loading }: { usage?: ProviderUsageSnapshot | null; loading?: boolean }) {
  if (!usage && !loading) return null

  return (
    <div className="py-2" data-slot="provider-usage">
      <div className="flex items-center justify-between py-1.5 gap-3">
        <span className="text-xs text-text-muted">Subscription usage</span>
        {loading && !usage ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-muted">
            <MorphSpinner color="var(--muted-foreground)" />
            Loading
          </span>
        ) : (
          usage?.planType ? <span className="text-sm font-medium text-contrast">{formatPlan(usage.planType)}</span> : null
        )}
      </div>

      {usage?.buckets.flatMap(bucket => bucket.windows.map(window => {
        const used = Math.max(0, Math.min(100, window.usedPercent))
        const remaining = remainingProviderUsage(window)
        const windowLabel = formatProviderUsageWindow(window.windowDurationMinutes)
        const label = usage.buckets.length === 1 || bucket.name === usage.displayName
          ? windowLabel
          : `${bucket.name} · ${windowLabel}`
        const reset = formatReset(window.resetsAt)
        return (
          <div key={`${bucket.id}:${window.id}`} className="py-1.5" data-provider-usage-window={`${bucket.id}:${window.id}`}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="min-w-0 truncate text-text-muted" title={label}>{label}</span>
              <span className="shrink-0 font-medium text-contrast">{remaining}% left</span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-overlay-6">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${used}%`,
                  backgroundColor: usageToneColor(used),
                }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-text-muted">
              <span>{Math.round(used * 10) / 10}% used</span>
              {reset && <span>Resets {reset}</span>}
            </div>
          </div>
        )
      }))}

      {usage?.resetCreditsAvailable != null && usage.resetCreditsAvailable > 0 && (
        <StatRow label="Full resets available" value={String(usage.resetCreditsAvailable)} />
      )}
    </div>
  )
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

/** One identifier in the footer: a short label, the hash, copy, and open. `label` names it for assistive tech. */
function IdentifierChip({ short, label, value, kind }: { short: string; label: string; value: string; kind: SessionResourceKind }) {
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
    <span className="inline-flex items-center gap-1" data-slot="session-info-identifier" data-identifier={kind}>
      <span className="text-[11px] text-text-muted">{short}</span>
      <code className="min-w-0 truncate rounded-md bg-overlay-6 px-1.5 font-mono text-[11px] leading-5 text-text-muted" title={value}>
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
    </span>
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

function findOption(options: SessionConfigOption[] | undefined, value: string | null | undefined) {
  if (!value) return undefined
  const normalized = value.toLowerCase()
  return options?.find(option =>
    option.value.toLowerCase() === normalized
    || option.aliases?.some(alias => alias.toLowerCase() === normalized))
}

function ConfigSelect({ label, value, options, onChange, disabled, optionDisabled, optionTitle, slot }: {
  label: string
  value: string
  options: SessionConfigOption[]
  onChange: (value: string) => void
  disabled?: boolean
  /** One option that can't be chosen, while the others can. */
  optionDisabled?: (value: string) => boolean
  optionTitle?: (option: SessionConfigOption) => string
  slot?: string
}) {
  const hasIcons = options.some(o => o.icon || o.iconSvgPath || o.color)

  if (hasIcons) {
    return (
      <div className="flex items-center justify-between gap-3 py-1.5" data-slot={slot}>
        <span className="text-xs text-text-muted shrink-0">{label}</span>
        <div className="flex flex-wrap items-center justify-end gap-1" role="group" aria-label={label}>
          {options.map(o => {
            const active = value === o.value
            const off = disabled || !!optionDisabled?.(o.value)
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => !off && onChange(o.value)}
                disabled={off}
                aria-pressed={active}
                data-value={o.value}
                title={optionTitle?.(o) ?? o.label}
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

const CAP_TITLE = "Above the limit this session was started with"
const FULL_OFF_TITLE = "Full access is turned off in Settings"

/**
 * The session's access level, with one line saying what the shown level lets
 * the agent do. Full stays visible while it is turned off, so the person learns
 * where it is turned on. A refused change keeps the previous level and says why.
 */
function AccessLevelRow({ level, choices, onChange, fullAccessSettingsHref, onNavigate }: {
  level: AccessLevel | null
  choices: AccessLevelChoice[]
  onChange?: (level: AccessLevel) => Promise<void>
  fullAccessSettingsHref?: string
  onNavigate: () => void
}) {
  const [choosing, setChoosing] = useState<AccessLevel | null>(null)
  // A change the server accepted, shown until the host's stats catch up with it.
  const [accepted, setAccepted] = useState<AccessLevel | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { setAccepted(null) }, [level])
  const shown = choosing ?? accepted ?? level
  const fullOff = choices.some(choice => choice.level === "full" && choice.disabledReason === "full_access_not_enabled")

  const choose = async (next: string) => {
    if (!onChange || !isAccessLevel(next)) return
    setChoosing(next)
    setError(null)
    try {
      await onChange(next)
      setAccepted(next)
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "The access level didn't change.")
    } finally {
      setChoosing(null)
    }
  }

  return (
    <div data-slot="access-level-row" data-access-level={shown ?? undefined}>
      {onChange ? (
        <ConfigSelect
          slot="access-level-select"
          label="Permissions"
          value={shown ?? ""}
          options={choices.map(choice => choice.option)}
          onChange={value => void choose(value)}
          disabled={!!choosing}
          optionDisabled={value => !!choices.find(choice => choice.level === value)?.disabledReason}
          optionTitle={option => {
            const reason = choices.find(choice => choice.level === option.value)?.disabledReason
            return reason === "above_session_cap" ? `${option.label}: ${CAP_TITLE}`
              : reason === "full_access_not_enabled" ? `${option.label}: ${FULL_OFF_TITLE}`
              : option.label
          }}
        />
      ) : (
        <StatRow label="Permissions" value={shown ? ACCESS_LEVEL_LABELS[shown] : "--"} />
      )}
      {shown && (
        <p data-slot="access-level-description" className="pb-1 text-right text-[11px] leading-snug text-text-muted">
          {ACCESS_LEVEL_DESCRIPTIONS[shown]}
        </p>
      )}
      {onChange && fullOff && (
        <p className="pb-1 text-right text-[11px] leading-snug">
          {fullAccessSettingsHref ? (
            <a data-slot="full-access-settings-link" href={fullAccessSettingsHref} onClick={onNavigate}
              className="text-primary underline-offset-2 hover:underline">
              Enable Full access in Settings
            </a>
          ) : (
            <span className="text-text-muted">Enable Full access in Settings</span>
          )}
        </p>
      )}
      {choosing && (
        <div className="flex items-center justify-end gap-1.5 pb-1 text-[10px] text-text-muted">
          <MorphSpinner color="var(--muted-foreground)" />
          <span>Changing to {ACCESS_LEVEL_LABELS[choosing]}...</span>
        </div>
      )}
      {error && <p role="alert" data-slot="access-level-error" className="pb-1 text-right text-xs text-red-400">{error}</p>}
    </div>
  )
}

const PERMISSION_ICONS: Record<AccessLevel, string> = {
  plan: "ph-bold ph-eye",
  ask: "ph-bold ph-shield-check",
  auto: "ph-bold ph-sparkle",
  full: "ph-bold ph-shield-warning",
}

type InfoTab = "overview" | "skills" | "memory" | "workspace" | "settings" | "usage"

/** The status dot on the hero's avatar: the host's status word, drawn from design-system tones. */
function statusDotClass(status?: string): string {
  switch (status?.toLowerCase()) {
    case "active": case "thinking": case "starting": case "working": return "bg-accent-teal"
    case "error": return "bg-accent-red"
    case "stopped": case "archived": return "bg-text-muted"
    default: return "bg-accent-gold"
  }
}

function TabCount({ n }: { n: number }) {
  return <span className="rounded bg-overlay-6 px-1 text-[10px] tabular-nums text-text-muted">{n}</span>
}

const EMPTY: never[] = []

export function SessionStatsModal({
  open, onOpenChange, stats, messages, agent, modelOptions, effortOptions, qualityTierOptions, providerOptions,
  providerUsage, providerUsageLoading, onConfigChange, onAccessLevelChange, fullAccessEnabled, fullAccessSettingsHref,
  children, subtitle, skills, node, workspace, memory, instructions, workingOn, nodeExtra, workspaceExtra, primaryLink,
  historyPartial,
}: Props) {
  const s = stats ?? {} as SessionStats
  const maxContext = getMaxContext(s)
  const pct = getContextPercent(s)
  const userMessages = messages.filter(m => m.role === "user").length
  const [updating, setUpdating] = useState(false)
  const [tab, setTab] = useState<InfoTab>("overview")
  const providerValue = s.providerEntity ?? s.provider
  const providerOption = findOption(providerOptions, providerValue)
  const qualityTierOption = findOption(qualityTierOptions, s.qualityTier)
  const thinking = formatProviderEffort(s.effort)

  // Worked out from the loaded messages, and only while the modal is open.
  const usedSkills = useMemo(() => open && skills ? deriveUsedSkills(messages) : EMPTY, [open, skills, messages])
  const openedMemory = useMemo(() => open && memory ? deriveOpenedMemory(messages, memory.root) : EMPTY, [open, memory, messages])
  const toolCalls = useMemo(() => open ? countToolCalls(messages) : 0, [open, messages])

  // Each time the modal opens it starts on Overview.
  useEffect(() => { if (open) setTab("overview") }, [open])

  const accessChoices = accessLevelChoices({ supported: s.supportedAccessLevels, max: s.maxAccessLevel, fullAccessEnabled })
  const accessLevel = isAccessLevel(s.accessLevel) ? s.accessLevel : null
  const accessRow = accessChoices.length > 0 && (
    <AccessLevelRow
      key={s.sessionId ?? undefined}
      level={accessLevel}
      choices={accessChoices}
      onChange={onAccessLevelChange ?? (onConfigChange ? level => onConfigChange({ accessLevel: level }) : undefined)}
      fullAccessSettingsHref={fullAccessSettingsHref}
      onNavigate={() => onOpenChange(false)}
    />
  )

  const hasConfig = onConfigChange && (modelOptions || effortOptions || qualityTierOptions || accessChoices.length > 0)

  const handleConfigChange = async (config: SessionConfigChange) => {
    if (!onConfigChange) return
    setUpdating(true)
    try {
      await onConfigChange(config)
    } finally {
      setUpdating(false)
    }
  }

  const close = () => onOpenChange(false)
  const showInstructions = !memory && !!instructions
  const showWorkspace = !!(node || workspace || nodeExtra || workspaceExtra)
  const tabs: { value: InfoTab; label: string; icon: string; count?: number }[] = [
    { value: "overview", label: "Overview", icon: "ph-bold ph-sparkle" },
    ...(skills ? [{ value: "skills" as const, label: "Skills", icon: "ph-bold ph-puzzle-piece", count: skills.items.length }] : []),
    ...(memory ? [{ value: "memory" as const, label: "Memory", icon: "ph-bold ph-brain" }] : []),
    ...(showInstructions ? [{ value: "memory" as const, label: "Instructions", icon: "ph-bold ph-files" }] : []),
    ...(showWorkspace ? [{ value: "workspace" as const, label: "Workspace", icon: "ph-bold ph-folder-simple" }] : []),
    { value: "settings", label: "Settings", icon: "ph-bold ph-sliders-horizontal" },
    { value: "usage", label: "Usage", icon: "ph-bold ph-chart-bar" },
  ]
  const activeTab = tabs.some(t => t.value === tab) ? tab : "overview"

  const title = agent?.name ?? s.name ?? "Session"
  const heroSubtitle = subtitle ?? (agent ? s.name : undefined)
  const providerLabel = providerOption?.label ?? providerValue
  const modelLabel = shortModel(s.model)
  const providerChip = [providerLabel, s.model ? modelLabel : null].filter(Boolean).join(" · ")
  const ringColor = usageToneColor(pct ?? 0)
  const link = primaryLink ?? (agent?.href ? { href: agent.href, label: `Open ${agent.name}` } : null)

  const usageWindow = providerUsage?.buckets[0]?.windows[0]
  const usageWindowLeft = usageWindow ? remainingProviderUsage(usageWindow) : null
  const cost = s.costUsd != null ? `${formatCostShort(s.costUsd)}${s.costEstimated ? " est." : ""}` : null
  const duration = s.startedAt ? formatDuration(s.startedAt) : null
  const skillsResolved = skills ? resolveSkills(skills, usedSkills) : null
  const usedChips = skillsResolved?.used.slice(0, 4) ?? []

  const overview = (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-2.5 min-[480px]:grid-cols-2">
        {skills && skillsResolved && (
          <GlanceTile slot="session-info-tile-skills" icon="ph-bold ph-puzzle-piece" title="Skills"
            value={`${skills.items.length} available`} onClick={() => setTab("skills")}>
            <span className="flex flex-wrap items-center gap-1">
              {usedChips.map(skill => (
                <Chip key={skill.id} icon={skill.icon || "ph-bold ph-puzzle-piece"} className="h-5 text-[11px]">{skill.name}</Chip>
              ))}
              {skillsResolved.used.length > usedChips.length && (
                <span className="text-[11px] text-text-muted">+{skillsResolved.used.length - usedChips.length}</span>
              )}
              <span className="text-[11px] text-text-muted">
                {skillsResolved.used.length > 0 ? "used here" : "none used here yet"}
              </span>
            </span>
          </GlanceTile>
        )}
        {memory && (
          <GlanceTile slot="session-info-tile-memory" icon="ph-bold ph-brain" title="Memory"
            value={`${memory.readAtStart.length} notes at start · ${openedMemory.length} opened`} onClick={() => setTab("memory")}>
            {memorySummary(memory) && (
              <span className="flex items-center gap-1.5 text-[11px] text-text-muted">
                {memory.mood?.colorValue && (
                  <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: memory.mood.colorValue }} />
                )}
                <span className="truncate">{memorySummary(memory)}</span>
              </span>
            )}
          </GlanceTile>
        )}
        {showInstructions && instructions && (
          <GlanceTile slot="session-info-tile-instructions" icon="ph-bold ph-files" title="Instructions"
            value={instructions.files.map(file => file.path.split("/").pop()).join(" · ") || "Instruction files"}
            onClick={() => setTab("memory")}>
            <span className="text-[11px] text-text-muted">
              {instructions.files.length} {instructions.files.length === 1 ? "file" : "files"}
              {instructions.skillsFolder?.count != null ? ` · ${instructions.skillsFolder.count} skills` : ""}
            </span>
          </GlanceTile>
        )}
        {showWorkspace && (
          <GlanceTile slot="session-info-tile-workspace"
            icon={workspace?.kind === "repository" ? "ph-bold ph-git-branch" : "ph-bold ph-folder-simple"}
            title="Workspace" value={workspace?.summary ?? node?.name ?? "Node"} onClick={() => setTab("workspace")}>
            {node && (
              <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
                <NodeIcon icon={node.icon} color={node.color} os={node.os} className="text-xs" />
                <span className="shrink-0 text-text-default">{node.name}</span>
                {node.folder && <code className="truncate font-mono" title={node.folder}>{node.folder}</code>}
              </span>
            )}
          </GlanceTile>
        )}
        <GlanceTile slot="session-info-tile-usage" icon="ph-bold ph-chart-bar" title="Usage"
          value={[cost, duration].filter(Boolean).join(" · ") || "--"} onClick={() => setTab("usage")}>
          {usageWindow && usageWindowLeft != null && (
            <span className="flex items-center gap-2 text-[11px] text-text-muted">
              <Bar pct={usageWindow.usedPercent} color={usageToneColor(usageWindow.usedPercent)} className="flex-1" />
              <span className="shrink-0">{usageWindowLeft}% left · {formatProviderUsageWindow(usageWindow.windowDurationMinutes)}</span>
            </span>
          )}
        </GlanceTile>
      </div>

      {workingOn && (
        <div>
          <SectionLabel>Working on</SectionLabel>
          <Tile className="flex items-center gap-2.5" data-slot="session-info-working-on">
            <i aria-hidden="true" className="ph-bold ph-git-diff text-sm text-text-muted" />
            <span className="flex-1 text-xs text-text-default">{workingOn.summary}</span>
          </Tile>
        </div>
      )}

      {children && (
        <div>
          <SectionLabel>This discussion</SectionLabel>
          <div className="flex flex-col gap-2">{children}</div>
        </div>
      )}
    </div>
  )

  const settings = (
    <div className="min-w-0" data-slot="session-info-settings">
      {providerValue && <EntityStatRow label="Provider" value={providerValue} option={providerOption} />}
      {hasConfig && modelOptions ? (
        <ConfigSelect
          label="Model"
          value={currentModelAlias(s.model)}
          options={modelOptions}
          onChange={v => handleConfigChange({ model: v })}
          disabled={updating}
        />
      ) : (
        <StatRow label="Model" value={modelLabel} />
      )}
      {hasConfig && qualityTierOptions && (
        <ConfigSelect
          label="Quality"
          value={s.qualityTier || ""}
          options={qualityTierOptions}
          onChange={v => handleConfigChange({ qualityTier: v })}
          disabled={updating}
        />
      )}
      {hasConfig && effortOptions && !qualityTierOptions && (
        <ConfigSelect
          label="Quality"
          value={s.effort || "high"}
          options={effortOptions}
          onChange={v => handleConfigChange({ effort: v })}
          disabled={updating}
        />
      )}
      {s.qualityTier && !(onConfigChange && qualityTierOptions) && (
        <EntityStatRow label="Quality" value={s.qualityTier} option={qualityTierOption} />
      )}
      {thinking && <StatRow label="Thinking" value={thinking} />}
      {accessRow}
      {updating && (
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-text-muted">
          <MorphSpinner color="var(--muted-foreground)" />
          <span>Restarting session...</span>
        </div>
      )}
    </div>
  )

  const usageTab = (
    <div className="flex flex-col gap-5" data-slot="session-info-usage">
      {pct != null && (
        <div>
          <SectionLabel trailing={<span className="text-[11px] text-text-muted">{pct}%</span>}>Context</SectionLabel>
          <Bar pct={pct} color={usageToneColor(pct)} />
        </div>
      )}
      <div className="grid grid-cols-2 gap-2.5 min-[560px]:grid-cols-3">
        <StatTile label="Context" value={formatTokens(getContextTokens(s) || null)} sub={getContextTokens(s) ? `/ ${formatTokens(maxContext)}` : undefined} />
        <StatTile label="Output" value={formatTokens(s.outputTokens)} />
        {s.cachedInputTokens != null && <StatTile label="Cached input" value={formatTokens(s.cachedInputTokens)} />}
        <StatTile label="Messages" value={String(s.messageCount || messages.length)} sub={`${userMessages} from you`} />
        <StatTile label="Tool calls" value={String(toolCalls)} />
        {s.costUsd != null && <StatTile label={s.costEstimated ? "Est. standard API cost" : "Cost"} value={formatCost(s.costUsd)} />}
        {duration && <StatTile label="Duration" value={duration} />}
      </div>
      <ProviderUsageBlock usage={providerUsage} loading={providerUsageLoading} />
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 p-0" style={{ maxWidth: "min(760px, calc(100% - 2rem))" }}>
        <div className="shrink-0 px-5 pt-5 pb-4" data-slot="session-info-hero">
          <div className="flex items-center gap-4">
            <div className="relative shrink-0">
              {agent ? (
                agent.avatarUrl ? (
                  <img src={agent.avatarUrl} alt="" className="size-16 rounded-full object-cover object-top ring-2 ring-primary-a40" />
                ) : (
                  <div aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-overlay-6 text-xl font-semibold text-contrast ring-2 ring-primary-a40">
                    {agent.name.slice(0, 1).toUpperCase()}
                  </div>
                )
              ) : (
                <div aria-hidden="true" className="grid size-14 place-items-center rounded-xl bg-primary-a15 text-primary ring-1 ring-primary-a30">
                  <i className="ph-bold ph-code text-2xl" />
                </div>
              )}
              {s.status && (
                <span title={s.status} aria-hidden="true"
                  className={cn("absolute -right-0.5 -bottom-0.5 size-3.5 rounded-full ring-2 ring-popover", statusDotClass(s.status))} />
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline gap-2">
                <DialogTitle className="truncate text-lg font-semibold text-contrast">{title}</DialogTitle>
                {s.status && <span className="shrink-0 text-xs text-text-muted" data-slot="session-info-status">{s.status.toLowerCase()}</span>}
              </div>
              {heroSubtitle && <p className="truncate text-sm text-text-muted">{heroSubtitle}</p>}
              <div className="mt-2 flex flex-wrap gap-1.5" data-slot="session-info-chips">
                {providerChip && (
                  <Chip title="Provider and model">{providerChip}</Chip>
                )}
                {s.qualityTier && (
                  <Chip title="Quality" style={qualityTierOption?.color ? { color: qualityTierOption.color } : undefined}>
                    {qualityTierOption?.label ?? s.qualityTier}
                  </Chip>
                )}
                {accessLevel && (
                  <Chip title="Permissions" icon={PERMISSION_ICONS[accessLevel]}>{ACCESS_LEVEL_LABELS[accessLevel]}</Chip>
                )}
                {node && (
                  <span title={`Runs on ${node.name}`} data-slot="session-info-node-chip"
                    className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-overlay-6 px-2 text-xs text-text-default">
                    <NodeIcon icon={node.icon} color={node.color} os={node.os} />
                    <span className="truncate">{node.name}</span>
                  </span>
                )}
              </div>
            </div>
            {pct != null && <div className="self-end"><ContextRing pct={pct} color={ringColor} /></div>}
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={value => setTab(String(value) as InfoTab)} className="min-h-0 flex-1 gap-0">
          <div className="px-5">
            <TabsList variant="settings" aria-label="Session info">
              {tabs.map(t => (
                <TabsTrigger key={t.label} value={t.value}>
                  <i aria-hidden="true" className={cn(t.icon, "text-[13px]")} />
                  {t.label}
                  {t.count != null && <TabCount n={t.count} />}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
          {/* A fixed height: switching tabs never resizes the modal. */}
          <div data-slot="session-stats-scroll"
            className="h-[min(430px,calc(100svh-17rem))] min-h-40 overflow-y-auto overscroll-contain px-5 py-4">
            <TabsContent value="overview">{overview}</TabsContent>
            {skills && (
              <TabsContent value="skills">
                <SkillsPanel skills={skills} used={usedSkills} historyPartial={historyPartial} onNavigate={close} />
              </TabsContent>
            )}
            {memory && (
              <TabsContent value="memory">
                <MemoryPanel memory={memory} opened={openedMemory} historyPartial={historyPartial} onNavigate={close} />
              </TabsContent>
            )}
            {showInstructions && instructions && (
              <TabsContent value="memory"><InstructionsPanel instructions={instructions} /></TabsContent>
            )}
            {showWorkspace && (
              <TabsContent value="workspace">
                <div className="flex flex-col gap-5">
                  <NodeSection node={node} extra={nodeExtra} />
                  {workspace && (
                    <WorkspaceSection workspace={workspace} onNavigate={close}
                      label={workspace.kind === "repository" ? "Repository" : "Workspace"} />
                  )}
                  {workspaceExtra}
                </div>
              </TabsContent>
            )}
            <TabsContent value="settings">{settings}</TabsContent>
            <TabsContent value="usage">{usageTab}</TabsContent>
          </div>
        </Tabs>

        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-overlay-6 px-5 py-2" data-slot="session-info-footer">
          {s.discussionId && <IdentifierChip short="Discussion" label="Discussion ID" value={s.discussionId} kind="discussion" />}
          {s.sessionId && <IdentifierChip short="Session" label="Session ID" value={s.sessionId} kind="session" />}
          {s.jobHash && <IdentifierChip short="Job" label="Job hash" value={s.jobHash} kind="job" />}
          <span className="flex-1" />
          {link && (
            <a href={link.href} onClick={close} data-slot="session-info-primary-link"
              className={buttonVariants({ variant: "ghost", size: "sm", className: "text-text-muted" })}>
              <Icon name="ph-bold ph-arrow-square-out" aria-hidden="true" className="size-3.5" /> {link.label}
            </a>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
