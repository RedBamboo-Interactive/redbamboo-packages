import type { MessageBlock, MessagePart } from "../types.ts"
import type { ActivityTimelineRow } from "./activity-timeline.ts"
import { isEventBlock } from "./event-parts.ts"

/**
 * Job cards: async compute jobs an agent starts (images, video, music,
 * workflows) shown as a small card in the agent message that launched them.
 *
 * Display only. Nothing here reads or writes transcript records, unread,
 * delivery, streaming or turn state: a job is matched to the tool call whose
 * result names it, else to a message by time, and the messages are never changed. Hosts fetch jobs through their own
 * authorized endpoint (never from a broadcast payload) and hand the records
 * to `normalizeChatJob`; ChatPanel anchors, groups and draws them.
 */

/** A RedCompute job as the hosts' authorized endpoints return it (list row or detail). */
export interface ComputeJobRecord {
  id: string
  capability?: string | null
  /** The WebSocket frame's name for `capability`. */
  capabilitySlug?: string | null
  providerName?: string | null
  status: string
  queuedAt?: string | null
  startedAt?: string | null
  completedAt?: string | null
  durationMs?: number | null
  /** 0..1. Sits at 0 while the job waits for the GPU, so 0 is not progress. */
  progress?: number | null
  /** admitted | waiting | executing | completed | failed | cancelled | skipped | timed_out */
  stage?: string | null
  terminal?: boolean | null
  outputs?: readonly ComputeJobOutput[] | null
  name?: string | null
  errorMessage?: string | null
  parentJobId?: string | null
  confidential?: boolean | null
  /** What was asked for, when the host projects it (a prompt or the main text input). */
  prompt?: string | null
}

export interface ComputeJobOutput {
  /** Browser-reachable URL (the host's authorized output route). */
  url: string
  contentType?: string | null
  sizeBytes?: number | null
}

export type ChatJobKind = "image" | "video" | "audio" | "workflow" | "generic"
/** `needs-you` has no producer yet: no job status says a person is needed. */
export type ChatJobState = "queued" | "running" | "needs-you" | "done" | "failed" | "stopped"

export interface ChatJob {
  id: string
  kind: ChatJobKind
  capability: string
  title: string
  /** Who runs it, e.g. "ComfyUI"; the card's first subtitle part. */
  provider: string | null
  state: ChatJobState
  /** 0..1 only when the job reports real progress; null means "don't draw a percentage". */
  progress: number | null
  /**
   * 0..1, how far a stopped job got before it was stopped: RedCompute keeps the
   * last reported progress on a cancelled record. Null otherwise.
   */
  stoppedProgress?: number | null
  stage: string | null
  queuedAt: string | null
  startedAt: string | null
  completedAt: string | null
  durationMs: number | null
  outputs: ComputeJobOutput[]
  errorMessage: string | null
  /** What was asked for, when known; the summary shows it. */
  prompt: string | null
  parentJobId: string | null
  /** The job's page in the Compute app: an expert option in the card's menu, never the click. */
  href: string | null
  /** Children present in the same set, folded under this job (image batches, workflow steps). */
  children: ChatJob[]
}

/**
 * Every decision about which jobs get a card, in one place. Laurent's rules
 * (f6e6c083, 2026-11-16); change them here.
 */
export const JOB_CARD_RULES = {
  /** Never cards: the chat's own turns and titles, delegated sessions, spoken lines, dictation. */
  excludedCapabilities: ["ai-session", "tts", "stt"] as readonly string[],
  /** A success this quick needs no card. Failures always show. */
  quickSuccessMs: 2000,
} as const

const TERMINAL = new Set(["Completed", "Failed", "Cancelled", "Skipped", "TimedOut"])

export function isTerminalJobStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL.has(status)
}

export function jobCapability(record: Pick<ComputeJobRecord, "capability" | "capabilitySlug">): string {
  return (record.capability ?? record.capabilitySlug ?? "").trim()
}

export function jobState(status: string | null | undefined): ChatJobState {
  switch (status) {
    case "Queued": return "queued"
    case "Running": return "running"
    case "Completed": return "done"
    case "Failed":
    case "TimedOut": return "failed"
    case "Cancelled":
    case "Skipped": return "stopped"
    default: return "running"
  }
}

/** Kind by capability, else by what it produced, else generic: new job types work on day one. */
export function jobKind(capability: string, outputs?: readonly Pick<ComputeJobOutput, "contentType" | "url">[] | null): ChatJobKind {
  const slug = capability.toLowerCase()
  if (slug.startsWith("image") || slug === "upscale" || slug === "inpaint") return "image"
  if (slug.startsWith("video") || slug === "i2v" || slug === "t2v") return "video"
  if (slug.startsWith("music") || slug.startsWith("audio") || slug.startsWith("sfx") || slug.startsWith("sound")) return "audio"
  if (slug === "workflow" || slug.startsWith("workflow-")) return "workflow"
  const type = outputs?.find(output => output.contentType)?.contentType ?? ""
  if (type.startsWith("image/")) return "image"
  if (type.startsWith("video/")) return "video"
  if (type.startsWith("audio/")) return "audio"
  return "generic"
}

/** Real progress only: a running job past 0 and short of done. */
export function realProgress(record: Pick<ComputeJobRecord, "status" | "progress">): number | null {
  const value = record.progress
  if (record.status !== "Running" || typeof value !== "number" || !Number.isFinite(value)) return null
  return value > 0 && value < 1 ? value : null
}

/** How far a stopped job got: the last progress a cancelled or skipped record kept, past 0. */
export function stoppedProgress(record: Pick<ComputeJobRecord, "status" | "progress">): number | null {
  const value = record.progress
  if (jobState(record.status) !== "stopped" || typeof value !== "number" || !Number.isFinite(value)) return null
  return value > 0 ? Math.min(value, 1) : null
}

function durationOf(record: ComputeJobRecord): number | null {
  if (typeof record.durationMs === "number" && Number.isFinite(record.durationMs)) return record.durationMs
  const started = Date.parse(record.startedAt ?? record.queuedAt ?? "")
  const ended = Date.parse(record.completedAt ?? "")
  return Number.isFinite(started) && Number.isFinite(ended) ? Math.max(0, ended - started) : null
}

/** True when this job never gets a card, whatever its anchor. */
export function isExcludedJob(record: ComputeJobRecord, rules = JOB_CARD_RULES): boolean {
  if (rules.excludedCapabilities.includes(jobCapability(record).toLowerCase())) return true
  if (record.status === "Completed") {
    const duration = durationOf(record)
    if (duration !== null && duration < rules.quickSuccessMs) return true
  }
  return false
}

const CAPABILITY_LABELS: Record<string, string> = {
  "image-gen": "Image",
  "video-gen": "Video",
  "music-gen": "Music",
  workflow: "Workflow",
}

/** "image-gen" -> "Image"; "model-download" -> "Model download". */
export function capabilityLabel(capability: string): string {
  if (CAPABILITY_LABELS[capability]) return CAPABILITY_LABELS[capability]
  const words = capability.replace(/[-_]+/g, " ").trim()
  return words ? words[0].toUpperCase() + words.slice(1) : "Job"
}

export interface NormalizeJobOptions {
  /** The job's page, e.g. the Compute app's job detail. Absent, the card is not a link. */
  jobHref?: (id: string) => string | null | undefined
}

export function normalizeChatJob(record: ComputeJobRecord, options: NormalizeJobOptions = {}): ChatJob {
  const capability = jobCapability(record)
  const outputs = (record.outputs ?? []).filter(output => typeof output?.url === "string" && output.url.length > 0)
  return {
    id: record.id,
    kind: jobKind(capability, outputs),
    capability,
    title: record.name?.trim() || capabilityLabel(capability),
    provider: record.providerName?.trim() || null,
    state: jobState(record.status),
    progress: realProgress(record),
    stoppedProgress: stoppedProgress(record),
    stage: record.stage ?? null,
    queuedAt: record.queuedAt ?? null,
    startedAt: record.startedAt ?? null,
    completedAt: record.completedAt ?? null,
    durationMs: durationOf(record),
    outputs: outputs.map(output => ({ url: output.url, contentType: output.contentType ?? null, sizeBytes: output.sizeBytes ?? null })),
    errorMessage: record.errorMessage?.trim() || null,
    prompt: record.prompt?.trim() || null,
    parentJobId: record.parentJobId ?? null,
    href: options.jobHref?.(record.id) ?? null,
    children: [],
  }
}

/**
 * Merge a newer read of one job into the known one. A terminal state never
 * regresses to a running one (a late or replayed read), so the same job
 * delivered by the list and by a refresh renders once, in its latest state.
 */
export function foldJobRecord(previous: ComputeJobRecord | undefined, next: ComputeJobRecord): ComputeJobRecord {
  if (!previous) return next
  if (isTerminalJobStatus(previous.status) && !isTerminalJobStatus(next.status)) return previous
  return {
    ...previous,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value !== undefined)),
  } as ComputeJobRecord
}

/**
 * Children whose parent is in the set fold under it, oldest first; a child
 * whose parent is not here stands on its own. Input order is otherwise kept.
 */
export function groupChatJobs(jobs: readonly ChatJob[]): ChatJob[] {
  const byId = new Map(jobs.map(job => [job.id, job] as const))
  const children = new Map<string, ChatJob[]>()
  const roots: ChatJob[] = []
  for (const job of jobs) {
    if (job.parentJobId && job.parentJobId !== job.id && byId.has(job.parentJobId)) {
      const list = children.get(job.parentJobId) ?? []
      list.push(job)
      children.set(job.parentJobId, list)
    } else {
      roots.push(job)
    }
  }
  const attach = (job: ChatJob, seen: Set<string>): ChatJob => {
    const own = children.get(job.id)
    if (!own?.length || seen.has(job.id)) return job
    seen.add(job.id)
    const sorted = [...own].sort((a, b) => time(a.queuedAt) - time(b.queuedAt))
    return { ...job, children: sorted.map(child => attach(child, seen)) }
  }
  return roots.map(job => attach(job, new Set()))
}

function time(value: string | null | undefined): number {
  const parsed = Date.parse(value ?? "")
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER
}

/** The logical turn a block belongs to: continuation segments share their turn's messageUid. */
export function turnKeyOf(block: MessageBlock): string {
  return typeof block.metadata?.messageUid === "string" ? block.metadata.messageUid : block.id
}

/** Where one job's card goes: its turn, and the block of that turn the card follows. */
export interface ChatJobAnchor {
  turnKey: string
  /** Index in `messages` of the block whose frieze the card follows. */
  blockIndex: number
}

/**
 * The agent turn a job belongs to, by time (jobs carry no turn identity):
 *
 * 1. The turn active at `queuedAt`: the latest agent turn that had started by
 *    then, unless a person's message came between its last block before
 *    `queuedAt` and `queuedAt`, in which case it is the turn answering that
 *    message (no card until that turn arrives).
 * 2. Else the latest agent message before `queuedAt` (work an ended turn left
 *    running, e.g. a background command).
 * 3. Else no card: the job is older than everything loaded. With earlier pages
 *    unloaded it may belong to one of them, so it waits for that page; without
 *    them it belongs to an earlier epoch (a clear, a rotation) and stays hidden.
 *
 * Known limit: rolled-back records leave every read and jobs carry no turn id,
 * so a job from a rolled-back turn falls back to the kept turn before it (2).
 */
export function anchorChatJob(
  queuedAt: string | null | undefined,
  messages: readonly MessageBlock[],
): ChatJobAnchor | null {
  const queued = Date.parse(queuedAt ?? "")
  if (!Number.isFinite(queued)) return null
  let firstLoaded = Number.POSITIVE_INFINITY
  for (const block of messages) {
    const at = Date.parse(block.timestamp)
    if (Number.isFinite(at)) { firstLoaded = at; break }
  }
  if (!(queued >= firstLoaded)) return null

  // The last agent block at or before queuedAt, and whether a person spoke after it.
  let agentIndex = -1
  let personAfter = -1
  for (let index = 0; index < messages.length; index++) {
    const block = messages[index]
    const at = Date.parse(block.timestamp)
    if (!Number.isFinite(at) || at > queued) continue
    if (block.role === "user") personAfter = index
    else if (!isEventBlock(block)) { agentIndex = index; personAfter = -1 }
  }
  if (personAfter >= 0) {
    // The job started after a person's message, before the answering turn's first block was stamped.
    for (let index = personAfter + 1; index < messages.length; index++) {
      const block = messages[index]
      if (block.role === "user") return null
      if (!isEventBlock(block)) return { turnKey: turnKeyOf(block), blockIndex: index }
    }
    return null
  }
  if (agentIndex < 0) return null
  return { turnKey: turnKeyOf(messages[agentIndex]), blockIndex: agentIndex }
}

/** Jobs in their anchored turns, in launch order, excluded ones and unanchorable ones left out. */
export interface AnchoredChatJobs {
  /** turnKey -> grouped jobs for that turn, in launch order. */
  byTurn: Map<string, { anchor: ChatJobAnchor; jobs: ChatJob[] }>
  /**
   * Each job's own block: the one holding the tool call that launched it when
   * a loaded result names it, else the block active when it was queued.
   */
  blockOf: Map<string, number>
  /** Every anchored top-level job, in launch order. */
  all: ChatJob[]
}

/*
 * Where a job was launched. An agent starts a job with a tool call whose result
 * names it (`{"jobId": "..."}`, or the id printed by a script), so the twin
 * belongs right after that call's square. The first result that names the job
 * is the launch; later ones (a poll, a download) come after it. Results are
 * often payloads whose text the browser hasn't fetched, so without a name the
 * twin follows the last call made by the time the job was queued (each call
 * carries its record's time). Neither: the end of the row active when it was
 * queued.
 *
 * Ids are pulled out of each result once and cached by the part object, so a
 * long transcript isn't rescanned on every streaming update.
 */
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const JOB_ID_FIELD = /"(?:jobId|job_id)"\s*:\s*"([^"\\]{1,200})"/g
const namedIds = new WeakMap<MessagePart, ReadonlySet<string>>()

/** Every job id a tool result names: GUIDs and `jobId`/`job_id` fields. */
export function idsNamedBy(result: MessagePart): ReadonlySet<string> {
  const cached = namedIds.get(result)
  if (cached) return cached
  const ids = new Set<string>()
  const text = result.content ?? ""
  for (const match of text.matchAll(UUID)) ids.add(match[0].toLowerCase())
  for (const match of text.matchAll(JOB_ID_FIELD)) ids.add(match[1].toLowerCase())
  namedIds.set(result, ids)
  return ids
}

/** The tool call a result answers: the same `toolUseId`, else the nearest call before it. */
function callAnswered(parts: readonly MessagePart[], resultIndex: number): number {
  const result = parts[resultIndex]
  if (result.toolUseId) {
    const byId = parts.findIndex(part => part.type === "tool_use" && part.toolUseId === result.toolUseId)
    if (byId !== -1) return byId
  }
  for (let index = resultIndex - 1; index >= 0; index--) {
    const part = parts[index]
    if (part.type !== "tool_use") continue
    if (result.messageId && part.messageId && part.messageId !== result.messageId) continue
    return index
  }
  return -1
}

/** Index in `parts` of the call whose result names `jobId`, or -1. */
function namedLaunch(jobId: string, parts: readonly MessagePart[]): number {
  const id = jobId.toLowerCase()
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]
    if (part.type !== "tool_result" || !idsNamedBy(part).has(id)) continue
    const call = callAnswered(parts, index)
    if (call !== -1) return call
  }
  return -1
}

/** Index of the last tool call in `parts` made at or before `queuedAt`, or -1. */
function startedBy(queuedAt: string | null | undefined, parts: readonly MessagePart[]): number {
  const queued = Date.parse(queuedAt ?? "")
  if (!Number.isFinite(queued)) return -1
  for (let index = parts.length - 1; index >= 0; index--) {
    const part = parts[index]
    if (part.type !== "tool_use" || !part.startedAt) continue
    const at = Date.parse(part.startedAt)
    if (Number.isFinite(at) && at <= queued) return index
  }
  return -1
}

/**
 * Index in `parts` of the square a job's twin follows, or -1 for the end of
 * the row: the call whose result names the job when the result's text is
 * loaded (exact); else the last call made by the time the job was queued
 * (results are often payloads the browser hasn't fetched, and a synchronous
 * launch is the call running when the job is queued).
 */
export function jobLaunchIndex(job: Pick<ChatJob, "id" | "queuedAt">, parts: readonly MessagePart[]): number {
  const named = namedLaunch(job.id, parts)
  return named !== -1 ? named : startedBy(job.queuedAt, parts)
}

/** Whether a loaded result in `parts` names `jobId`. */
export function namesJob(jobId: string, parts: readonly MessagePart[]): boolean {
  return namedLaunch(jobId, parts) !== -1
}

/** The block holding the tool call that launched `jobId`, or -1. */
export function jobLaunchBlock(jobId: string, messages: readonly MessageBlock[]): number {
  for (let index = 0; index < messages.length; index++) {
    const block = messages[index]
    if (block.role === "user" || isEventBlock(block)) continue
    if (namesJob(jobId, block.parts)) return index
  }
  return -1
}

export function anchorChatJobs(jobs: readonly ChatJob[], messages: readonly MessageBlock[]): AnchoredChatJobs {
  const byTurn = new Map<string, { anchor: ChatJobAnchor; jobs: ChatJob[] }>()
  const blockOf = new Map<string, number>()
  const all: ChatJob[] = []
  const ordered = [...groupChatJobs(jobs)].sort((a, b) => time(a.queuedAt) - time(b.queuedAt) || a.id.localeCompare(b.id))
  for (const job of ordered) {
    const launched = jobLaunchBlock(job.id, messages)
    const anchor = launched !== -1
      ? { turnKey: turnKeyOf(messages[launched]), blockIndex: launched }
      : anchorChatJob(job.queuedAt, messages)
    if (!anchor) continue
    blockOf.set(job.id, anchor.blockIndex)
    const entry = byTurn.get(anchor.turnKey)
    if (entry) {
      entry.jobs.push(job)
      // Cards follow the earliest anchored block of the turn they share.
      if (anchor.blockIndex < entry.anchor.blockIndex) entry.anchor = anchor
    } else {
      byTurn.set(anchor.turnKey, { anchor, jobs: [job] })
    }
    all.push(job)
  }
  return { byTurn, blockOf, all }
}

/**
 * The rendered row each anchored job's twin joins, keyed by row key, jobs in
 * launch order. A job is a twin at the end of the anchored block's LAST frieze
 * row (the most recent activity of that block at or before it was queued).
 * A block that draws no frieze row gets one in its last content row, holding
 * only twins. A block not rendered at all hands its twins to the first row of
 * a later block of the same turn. A job whose turn isn't rendered (outside
 * the render window) isn't shown.
 */
export function jobsByTimelineRow(
  rows: readonly ActivityTimelineRow[],
  anchored: AnchoredChatJobs,
  messages: readonly MessageBlock[],
): Map<string, ChatJob[]> {
  const byRow = new Map<string, ChatJob[]>()
  const launchOrder = new Map(anchored.all.map((job, index) => [job.id, index] as const))
  // Each job in its own block's row: the launching call's, else the block active when it was queued.
  for (const [turnKey, { anchor, jobs }] of anchored.byTurn) {
    for (const job of jobs) {
      const blockIndex = anchored.blockOf.get(job.id) ?? anchor.blockIndex
      const sameTurn = (index: number) => index >= blockIndex && !!messages[index]
        && messages[index].role !== "user" && turnKeyOf(messages[index]) === turnKey
      const holds = (row: ActivityTimelineRow) => row.sourceIndices.includes(blockIndex)
      // The row drawing the launching square, when one does; a block can project to several rows.
      const drawn = (candidate: ActivityTimelineRow) => candidate.kind !== "event-row" && holds(candidate)
      const row = rows.find(candidate => drawn(candidate) && namesJob(job.id, candidate.block.parts))
        ?? lastOf(rows, candidate => drawn(candidate) && jobLaunchIndex(job, candidate.block.parts) !== -1)
        ?? lastOf(rows, candidate => candidate.kind === "activity" && holds(candidate))
        ?? lastOf(rows, candidate => candidate.kind === "message" && holds(candidate))
        ?? rows.find(candidate => candidate.kind !== "event-row" && candidate.sourceIndices.some(sameTurn))
      if (!row) continue
      const list = byRow.get(row.key)
      if (list) list.push(job)
      else byRow.set(row.key, [job])
    }
  }
  for (const list of byRow.values()) list.sort((a, b) => (launchOrder.get(a.id) ?? 0) - (launchOrder.get(b.id) ?? 0))
  return byRow
}

function lastOf<T>(items: readonly T[], matches: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) if (matches(items[index])) return items[index]
  return undefined
}

/** Running or queued, i.e. what the activity row lists. */
export function isActiveJob(job: Pick<ChatJob, "state">): boolean {
  return job.state === "queued" || job.state === "running" || job.state === "needs-you"
}

/** Real progress of a job, or of its children when they report it, for one percentage. */
export function jobProgress(job: ChatJob): number | null {
  if (job.progress !== null) return job.progress
  if (!job.children.length) return null
  const done = job.children.filter(child => child.state === "done").length
  const running = job.children.reduce((sum, child) => sum + (child.progress ?? 0), 0)
  const value = (done + running) / job.children.length
  return value > 0 && value < 1 ? value : null
}

function shortTitle(job: ChatJob): string {
  return job.title.length > 40 ? `${job.title.slice(0, 39).trimEnd()}…` : job.title
}

/**
 * The activity row's words for running jobs, after any host work such as
 * delegations: "Launch covers 62%" for one, "2 jobs · Launch covers 62% · Theme queued" for several.
 */
export function describeJobActivity(active: readonly ChatJob[]): string | null {
  if (active.length === 0) return null
  const one = (job: ChatJob) => {
    const progress = jobProgress(job)
    if (job.state === "queued") return `${shortTitle(job)} queued`
    return progress !== null ? `${shortTitle(job)} ${Math.round(progress * 100)}%` : shortTitle(job)
  }
  if (active.length === 1) return one(active[0])
  const named = active.slice(0, 2).map(one)
  return [`${active.length} jobs`, ...named].join(" · ")
}

/** Elapsed time as the card says it: "0:14", "6:02", "1:12:05". */
export function formatJobDuration(ms: number | null | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return ""
  const total = Math.floor(ms / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, "0")
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`
}

/** The stage in words, for a running job without real progress. */
export function jobStageWords(job: Pick<ChatJob, "state" | "stage">): string | null {
  if (job.state === "queued") return "waiting to start"
  if (job.state !== "running") return null
  switch (job.stage) {
    case "admitted": return "waiting to start"
    case "waiting": return "starting up"
    case "executing": return "working"
    default: return null
  }
}

/** Milliseconds the job has been going (running) or took (finished). */
export function jobElapsed(job: Pick<ChatJob, "state" | "startedAt" | "queuedAt" | "durationMs">, now: number): number | null {
  if (job.state === "running") {
    const started = Date.parse(job.startedAt ?? job.queuedAt ?? "")
    return Number.isFinite(started) ? Math.max(0, now - started) : null
  }
  if (job.state === "queued") return null
  return job.durationMs
}
