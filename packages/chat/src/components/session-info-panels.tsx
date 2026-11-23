import { useMemo, useState, type ReactNode } from "react"
import { Badge, EntityCard, Input, NodeIcon, cn, nodeIdentity } from "@redbamboo/ui"
import type {
  SessionInfoInstructions,
  SessionInfoMemory,
  SessionInfoNode,
  SessionInfoSkill,
  SessionInfoSkills,
  SessionInfoWorkspace,
} from "../types"
import { skillKey, withoutPaths, type MemoryAccess, type OpenedMemoryFile, type UsedSkill } from "../lib/session-info-usage"

/**
 * The pieces of the Info modal's tabs. Everything here is drawn from what the host passed; a piece
 * with nothing to show is not drawn, and no value is made up.
 */

const DEFAULT_SKILL_ICON = "ph-bold ph-puzzle-piece"

export function SectionLabel({ children, trailing }: { children: ReactNode; trailing?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3">
      <h3 className="text-xs font-medium text-text-muted">{children}</h3>
      {trailing}
    </div>
  )
}

/** The bordered tile Nova's discussion toggles already use. */
export function Tile({ children, className, ...rest }: React.ComponentProps<"div">) {
  return <div {...rest} className={cn("rounded-lg border border-overlay-6 bg-overlay-3 px-3 py-2.5 text-left", className)}>{children}</div>
}

export function Chip({ icon, children, className, title, style }: {
  icon?: string
  children: ReactNode
  className?: string
  title?: string
  style?: React.CSSProperties
}) {
  return (
    <span title={title} style={style}
      className={cn("inline-flex h-6 max-w-full items-center gap-1.5 rounded-md bg-overlay-6 px-2 text-xs text-text-default", className)}>
      {icon && <i aria-hidden="true" className={cn(icon, "text-[13px]")} />}
      <span className="truncate">{children}</span>
    </span>
  )
}

export function Bar({ pct, color, className }: { pct: number; color?: string; className?: string }) {
  return (
    <div className={cn("h-1.5 overflow-hidden rounded-full bg-overlay-6", className)}>
      <div className="h-full rounded-full transition-all duration-500"
        style={{ width: `${Math.max(0, Math.min(100, pct))}%`, backgroundColor: color ?? "var(--color-accent-teal)" }} />
    </div>
  )
}

export function ContextRing({ pct, color }: { pct: number; color: string }) {
  const r = 22
  const c = 2 * Math.PI * r
  return (
    <div className="relative grid size-14 shrink-0 place-items-center" title="Context used" data-slot="session-info-context-ring">
      <svg viewBox="0 0 52 52" aria-hidden="true" className="absolute inset-0 -rotate-90">
        <circle cx="26" cy="26" r={r} fill="none" strokeWidth="4" className="stroke-overlay-10" />
        <circle cx="26" cy="26" r={r} fill="none" strokeWidth="4" strokeLinecap="round" stroke={color}
          strokeDasharray={`${(pct / 100) * c} ${c}`} />
      </svg>
      <div className="text-center leading-none">
        <div className="text-sm font-semibold text-contrast tabular-nums">{pct}%</div>
        <div className="mt-0.5 text-[9px] text-text-muted">context</div>
      </div>
    </div>
  )
}

/** An Overview tile that switches to its tab. */
export function GlanceTile({ icon, title, value, onClick, slot, children }: {
  icon: string
  title: string
  value: ReactNode
  onClick: () => void
  slot: string
  children?: ReactNode
}) {
  return (
    <button type="button" onClick={onClick} data-slot={slot}
      className="group flex min-w-0 flex-col gap-2 rounded-lg border border-overlay-6 bg-overlay-3 p-3 text-left transition-colors hover:border-overlay-10 hover:bg-overlay-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-a50">
      <span className="flex items-center gap-2">
        <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary-a15 text-primary">
          <i aria-hidden="true" className={cn(icon, "text-sm")} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[11px] text-text-muted">{title}</span>
          <span className="block truncate text-sm font-medium text-contrast">{value}</span>
        </span>
        <i aria-hidden="true" className="ph-bold ph-caret-right shrink-0 text-xs text-text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
      </span>
      {children}
    </button>
  )
}

export function StatTile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Tile className="flex min-w-0 flex-col gap-0.5">
      <span className="text-[11px] text-text-muted">{label}</span>
      <span className="truncate text-base font-semibold text-contrast tabular-nums">
        {value}
        {sub && <span className="ml-1 text-xs font-normal text-text-muted">{sub}</span>}
      </span>
    </Tile>
  )
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-9 items-center justify-between gap-3 py-1.5">
      <span className="shrink-0 text-xs text-text-muted">{label}</span>
      <div className="flex min-w-0 items-center justify-end gap-1">{children}</div>
    </div>
  )
}

function FileRow({ path, meta, badges, icon = "ph-bold ph-file-text" }: {
  path: string
  meta?: string | null
  badges?: ReactNode
  icon?: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-overlay-6">
      <i aria-hidden="true" className={cn(icon, "shrink-0 text-sm text-text-muted")} />
      <code className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-default" title={path}>{path}</code>
      {meta && <span className="hidden shrink-0 text-[11px] text-text-muted min-[480px]:inline">{meta}</span>}
      {badges}
    </div>
  )
}

export function PartialHistoryHint({ show }: { show?: boolean }) {
  if (!show) return null
  return (
    <p data-slot="session-info-partial-history" className="text-[11px] leading-relaxed text-text-muted">
      Only the messages loaded so far are counted. Earlier messages in this conversation aren't included.
    </p>
  )
}

/* ── Skills ───────────────────────────────────────────────────────────────── */

export interface ResolvedSkill extends SessionInfoSkill {
  used?: number
}

/** The skills the conversation used (known or not) and the ones the agent has but did not use. */
export function resolveSkills(skills: SessionInfoSkills, used: readonly UsedSkill[]): { used: ResolvedSkill[]; available: ResolvedSkill[] } {
  const byKey = new Map<string, SessionInfoSkill>()
  for (const skill of skills.items) {
    byKey.set(skillKey(skill.slug ?? skill.name), skill)
    byKey.set(skillKey(skill.name), skill)
  }
  const usedKeys = new Set<string>()
  const usedSkills = used.map(entry => {
    const known = byKey.get(skillKey(entry.name))
    if (known) usedKeys.add(known.id)
    return { ...(known ?? { id: `used:${skillKey(entry.name)}`, name: entry.name }), used: entry.count }
  })
  return { used: usedSkills, available: skills.items.filter(skill => !usedKeys.has(skill.id)) }
}

function SkillRow({ skill }: { skill: ResolvedSkill }) {
  return (
    <div className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-overlay-6" data-slot="session-info-skill" data-skill={skill.slug ?? skill.name}>
      <span className="grid size-8 shrink-0 place-items-center rounded-md bg-overlay-6 text-text-default">
        <i aria-hidden="true" className={cn(skill.icon || DEFAULT_SKILL_ICON, "text-base")} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-contrast">{skill.name}</div>
        {skill.description && <div className="truncate text-xs text-text-muted" title={skill.description}>{skill.description}</div>}
      </div>
      {skill.used ? <Badge variant="secondary" className="shrink-0">Used {skill.used}×</Badge> : null}
    </div>
  )
}

export function SkillsPanel({ skills, used, historyPartial, onNavigate }: {
  skills: SessionInfoSkills
  used: readonly UsedSkill[]
  historyPartial?: boolean
  onNavigate: () => void
}) {
  const [query, setQuery] = useState("")
  const resolved = useMemo(() => resolveSkills(skills, used), [skills, used])
  const needle = query.trim().toLowerCase()
  const matches = (skill: ResolvedSkill) => !needle
    || skill.name.toLowerCase().includes(needle)
    || (skill.description ?? "").toLowerCase().includes(needle)
  const usedShown = resolved.used.filter(matches)
  const availableShown = resolved.available.filter(matches)

  return (
    <div className="flex flex-col gap-4" data-slot="session-info-skills">
      <div className="relative">
        <i aria-hidden="true" className="ph-bold ph-magnifying-glass pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-text-muted" />
        <Input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Search ${skills.items.length} skills`}
          aria-label="Search skills" className="pl-8" />
      </div>
      {resolved.used.length > 0 && usedShown.length > 0 && (
        <div>
          <SectionLabel>Used in this discussion</SectionLabel>
          <div className="flex flex-col">{usedShown.map(skill => <SkillRow key={skill.id} skill={skill} />)}</div>
        </div>
      )}
      <div>
        <SectionLabel trailing={skills.manageHref ? (
          <a href={skills.manageHref} onClick={onNavigate} className="text-[11px] text-primary hover:underline">{skills.manageLabel ?? "Manage"}</a>
        ) : undefined}>Available</SectionLabel>
        {availableShown.length > 0
          ? <div className="flex flex-col">{availableShown.map(skill => <SkillRow key={skill.id} skill={skill} />)}</div>
          : <p className="px-2 text-xs text-text-muted">{needle ? "No skill matches your search." : "No other skills."}</p>}
      </div>
      <PartialHistoryHint show={historyPartial} />
    </div>
  )
}

/* ── Memory and instructions ──────────────────────────────────────────────── */

const ACCESS_LABELS: Record<MemoryAccess, string> = { read: "Read", edited: "Edited", searched: "Searched" }

export function memorySummary(memory: SessionInfoMemory): string {
  const mood = memory.mood
  const parts = [mood?.energy, mood?.vibe].filter((part): part is string => !!part)
  return parts.length > 0 ? `Today: ${parts.join(", ")}` : ""
}

export function MemoryPanel({ memory, opened, historyPartial, onNavigate }: {
  memory: SessionInfoMemory
  opened: readonly OpenedMemoryFile[]
  historyPartial?: boolean
  onNavigate: () => void
}) {
  const mood = memory.mood
  const moodHeadline = [mood?.energy ? `${mood.energy[0]!.toUpperCase()}${mood.energy.slice(1)} energy` : null, mood?.vibe].filter(Boolean).join(", ")
  const accessesOf = new Map(opened.map(file => [file.path.toLowerCase(), file.accesses]))
  const others = withoutPaths(opened, memory.readAtStart.map(note => note.path))
  const badges = (accesses: readonly MemoryAccess[]) => (
    <span className="flex shrink-0 gap-1">
      {accesses.map(access => <Badge key={access} variant="outline">{ACCESS_LABELS[access]}</Badge>)}
    </span>
  )
  return (
    <div className="flex flex-col gap-5" data-slot="session-info-memory">
      {mood && (moodHeadline || mood.colorName) && (
        <Tile className="flex items-center gap-3 p-3" data-slot="session-info-mood">
          {mood.colorValue && (
            <span aria-hidden="true" className="size-9 shrink-0 rounded-full ring-2 ring-overlay-10" style={{ backgroundColor: mood.colorValue }} />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-text-muted">Today's mood{mood.colorName ? ` · ${mood.colorName}` : ""}</div>
            {moodHeadline && <div className="text-sm font-medium text-contrast">{moodHeadline}</div>}
            {mood.note && <p className="mt-0.5 truncate text-[11px] text-text-muted" title={mood.note}>{mood.note}</p>}
          </div>
        </Tile>
      )}
      {memory.readAtStart.length > 0 && (
        <div>
          <SectionLabel>Startup notes</SectionLabel>
          {memory.readAtStart.map(note => {
            const accesses = accessesOf.get(note.path.toLowerCase())
            return (
              <FileRow key={note.path} path={note.path} meta={[note.label, note.meta].filter(Boolean).join(" · ") || null}
                badges={accesses ? badges(accesses) : undefined} />
            )
          })}
        </div>
      )}
      <div>
        <SectionLabel>Opened in this discussion</SectionLabel>
        {others.length > 0 ? others.map(file => <FileRow key={file.path} path={file.path} badges={badges(file.accesses)} />)
          : <p className="px-2 text-xs text-text-muted">No other memory notes opened in the loaded messages.</p>}
      </div>
      <PartialHistoryHint show={historyPartial} />
      {memory.workspaceHref && (
        <a href={memory.workspaceHref} onClick={onNavigate}
          className="inline-flex items-center gap-1.5 self-start text-xs text-primary hover:underline">
          <i aria-hidden="true" className="ph-bold ph-arrow-square-out" />
          {memory.workspaceLabel ?? "Open memory in the workspace"}
        </a>
      )}
    </div>
  )
}

export function InstructionsPanel({ instructions }: { instructions: SessionInfoInstructions }) {
  return (
    <div className="flex flex-col gap-5" data-slot="session-info-instructions">
      <div>
        <SectionLabel>Instruction files</SectionLabel>
        {instructions.files.map(file => <FileRow key={file.path} path={file.path} meta={file.meta} />)}
        {instructions.skillsFolder && (
          <FileRow icon="ph-bold ph-folder-simple" path={instructions.skillsFolder.path}
            meta={instructions.skillsFolder.count != null ? `${instructions.skillsFolder.count} skills` : null} />
        )}
      </div>
    </div>
  )
}

/* ── Node and workspace ───────────────────────────────────────────────────── */

export function NodeSection({ node, extra }: { node?: SessionInfoNode | null; extra?: ReactNode }) {
  if (!node && !extra) return null
  const identity = node ? nodeIdentity({ icon: node.icon, color: node.color, os: node.os }) : null
  const details = node
    ? [node.platformLabel, node.agentVersion ? `node agent ${node.agentVersion}` : null, "this session runs here"].filter(Boolean).join(" · ")
    : ""
  return (
    <div data-slot="session-info-node">
      <SectionLabel>Node</SectionLabel>
      <div className="flex flex-col gap-2">
        {node && (
          <Tile className="flex items-center gap-3 p-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-overlay-6"
              style={identity?.color ? { backgroundColor: `color-mix(in srgb, ${identity.color.hex} 15%, transparent)` } : undefined}>
              <NodeIcon icon={node.icon} color={node.color} os={node.os} className="text-xl" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-contrast">{node.name}</span>
                {node.online != null && (
                  <span className={cn("inline-flex shrink-0 items-center gap-1 text-[11px]", node.online ? "text-accent-teal" : "text-text-muted")}>
                    <span aria-hidden="true" className={cn("size-1.5 rounded-full", node.online ? "bg-accent-teal" : "bg-text-muted")} />
                    {node.online ? "online" : "offline"}
                  </span>
                )}
              </div>
              <div className="text-[11px] text-text-muted">{details}</div>
            </div>
          </Tile>
        )}
        {node?.onlyNode && (
          <p className="px-1 text-[11px] text-text-muted">
            This is your only node, so every session runs here.
          </p>
        )}
        {extra}
      </div>
    </div>
  )
}

export function WorkspaceSection({ workspace, onNavigate, label }: {
  workspace: SessionInfoWorkspace
  onNavigate: () => void
  label: string
}) {
  const href = workspace.entity.href
  return (
    <>
      <div data-slot="session-info-workspace">
        <SectionLabel>{label}</SectionLabel>
        <EntityCard
          entity={{ id: workspace.entity.id, typeSlug: workspace.entity.typeSlug, name: workspace.entity.name }}
          visual={{ icon: workspace.icon ?? undefined, fallbackText: workspace.entity.name }}
          subtitle={workspace.subtitle ?? undefined}
          size="md"
          variant="outlined"
          action={href ? { kind: "inspect", href, ariaLabel: `Open ${workspace.entity.name}`, onInspect: onNavigate } : undefined}
        />
      </div>
      {workspace.rows && workspace.rows.length > 0 && (
        <div className="divide-y divide-overlay-6">
          {workspace.rows.map(row => (
            <InfoRow key={row.label} label={row.label}>
              {row.mono
                ? <code className="truncate font-mono text-xs text-text-default" title={row.value}>{row.value}</code>
                : <span className="truncate text-xs text-text-default" title={row.value}>{row.value}</span>}
            </InfoRow>
          ))}
        </div>
      )}
    </>
  )
}
