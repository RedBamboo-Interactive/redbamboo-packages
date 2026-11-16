import { JOB_CARD_RULES, foldJobRecord, isTerminalJobStatus, type ComputeJobRecord } from "./chat-jobs.ts"

/**
 * Keeps one conversation's jobs current with as few reads as it can:
 *
 * - one bounded list when the conversation opens (`since` = its oldest loaded
 *   message), and one more per older page, for that page's window only;
 * - single-job re-reads for jobs it knows and that are still running, when a
 *   `job.*` frame names them, coalesced to one flush per `refreshIntervalMs`;
 * - a short list from the last list on (`discoveryOverlapMs` back) when a frame
 *   may concern a job it doesn't know yet;
 * - on reconnect, both; while anything is still running, a slow poll of those
 *   jobs only, in case a frame was missed. Nothing running, nothing polled.
 *
 * Frames are invalidations only: a payload is read to decide whether to
 * re-read, never stored or rendered. Every record comes from the host's
 * authorized transport.
 */
export interface ChatJobsTransport {
  /** Jobs of this conversation queued in [since, until). The host endpoint refuses an unbounded read. */
  list(window: { since: string; until?: string }, signal: AbortSignal): Promise<readonly ComputeJobRecord[]>
  /** One job through the same authorization; null when it is gone or not this conversation's. */
  get(id: string, signal: AbortSignal): Promise<ComputeJobRecord | null>
}

export interface ChatJobsSyncOptions {
  transport: ChatJobsTransport
  onChange: (records: ComputeJobRecord[]) => void
  /**
   * Whether a frame about a job this conversation doesn't know yet may be
   * one of its own (e.g. its provenance names this discussion). Absent, only
   * known jobs are refreshed and new ones appear on reconnect or the next open.
   */
  mayConcern?: (data: Record<string, unknown>) => boolean
  /** Confidential jobs arrive as content-free frames; a confidential conversation re-reads on them. */
  confidential?: boolean
  refreshIntervalMs?: number
  pollIntervalMs?: number
  discoveryOverlapMs?: number
  maxRefreshPerFlush?: number
  now?: () => number
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export class ChatJobsSync {
  private readonly records = new Map<string, ComputeJobRecord>()
  private readonly pending = new Set<string>()
  private readonly controller = new AbortController()
  private coveredSince: string | null = null
  private lastListedAt: number | null = null
  private discoveryWanted = false
  /** Unknown ids whose frames asked for a discovery that hasn't started yet. */
  private readonly discoveryIds = new Set<string>()
  /** Ids the discovery in flight was started for: it covers them, so their frames need nothing more. */
  private discoveringIds: ReadonlySet<string> | null = null
  /** Ids a finished discovery looked for and the endpoint didn't return: not this conversation's. */
  private readonly foreignIds = new Set<string>()
  private listing = false
  private readonly windows: Array<{ window: { since: string; until?: string }; listedAt: number | null; discovery?: boolean }> = []
  private flushTimer: unknown = null
  private pollTimer: unknown = null
  private lastFlushAt = Number.NEGATIVE_INFINITY
  private disposed = false
  private readonly options: Required<Omit<ChatJobsSyncOptions, "mayConcern" | "confidential">> & Pick<ChatJobsSyncOptions, "mayConcern" | "confidential">

  constructor(options: ChatJobsSyncOptions) {
    this.options = {
      refreshIntervalMs: 1000,
      pollIntervalMs: 15000,
      discoveryOverlapMs: 120000,
      maxRefreshPerFlush: 4,
      now: () => Date.now(),
      setTimer: (callback, ms) => setTimeout(callback, ms),
      clearTimer: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
      ...options,
    }
  }

  snapshot(): ComputeJobRecord[] {
    return [...this.records.values()]
  }

  /** The oldest loaded message's time. The first call lists; an earlier one lists that page's window. */
  setSince(since: string | null | undefined): void {
    if (this.disposed || !since || !Number.isFinite(Date.parse(since))) return
    if (this.coveredSince === null) {
      const started = this.options.now()
      this.coveredSince = since
      void this.runList({ since }, started)
    } else if (Date.parse(since) < Date.parse(this.coveredSince)) {
      const until = this.coveredSince
      this.coveredSince = since
      void this.runList({ since, until }, null)
    }
  }

  /** A `job.*` frame (or `job.event`). Never rendered: it only says what to re-read. */
  frame(type: string, data: unknown): void {
    if (this.disposed || !type.startsWith("job.") || !data || typeof data !== "object") return
    const payload = data as Record<string, unknown>
    const id = typeof payload.id === "string" ? payload.id : typeof payload.jobId === "string" ? payload.jobId : null
    if (!id) return
    const known = this.records.get(id)
    if (known) {
      if (!isTerminalJobStatus(known.status)) this.queueRefresh([id])
      return
    }
    const capability = typeof payload.capabilitySlug === "string" ? payload.capabilitySlug
      : typeof payload.capability === "string" ? payload.capability : null
    if (capability && JOB_CARD_RULES.excludedCapabilities.includes(capability.toLowerCase())) return
    const concerns = payload.confidential === true
      ? !!this.options.confidential
      : !!this.options.mayConcern?.(payload)
    if (concerns && !this.discoveringIds?.has(id) && !this.foreignIds.has(id)) this.queueDiscovery(id)
  }

  /** The event connection came back: frames may have been missed. */
  reconnected(): void {
    if (this.disposed || this.coveredSince === null) return
    this.queueRefresh(this.activeIds())
    this.queueDiscovery()
  }

  dispose(): void {
    this.disposed = true
    this.controller.abort()
    if (this.flushTimer !== null) this.options.clearTimer(this.flushTimer)
    if (this.pollTimer !== null) this.options.clearTimer(this.pollTimer)
    this.flushTimer = this.pollTimer = null
  }

  private activeIds(): string[] {
    return [...this.records.values()].filter(record => !isTerminalJobStatus(record.status)).map(record => record.id)
  }

  private queueRefresh(ids: readonly string[]): void {
    for (const id of ids) this.pending.add(id)
    this.scheduleFlush()
  }

  private queueDiscovery(id?: string): void {
    if (this.coveredSince === null) return
    if (id) this.discoveryIds.add(id)
    else this.discoveryWanted = true
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.disposed || this.flushTimer !== null) return
    if (!this.pending.size && !this.discoveryWanted && !this.discoveryIds.size) return
    const wait = Math.max(0, this.lastFlushAt + this.options.refreshIntervalMs - this.options.now())
    this.flushTimer = this.options.setTimer(() => {
      this.flushTimer = null
      void this.flush()
    }, wait)
  }

  private async flush(): Promise<void> {
    if (this.disposed) return
    this.lastFlushAt = this.options.now()
    if ((this.discoveryWanted || this.discoveryIds.size) && !this.listing && this.coveredSince !== null) {
      this.discoveryWanted = false
      this.discoveringIds = new Set(this.discoveryIds)
      this.discoveryIds.clear()
      const from = Math.max(Date.parse(this.coveredSince), (this.lastListedAt ?? 0) - this.options.discoveryOverlapMs)
      void this.runList({ since: new Date(from).toISOString() }, this.options.now(), true)
    }
    const ids = [...this.pending].slice(0, this.options.maxRefreshPerFlush)
    for (const id of ids) this.pending.delete(id)
    await Promise.all(ids.map(id => this.refreshOne(id)))
    // Whatever is left (more than one flush's worth, or a discovery behind a list) waits its turn.
    this.scheduleFlush()
  }

  private async refreshOne(id: string): Promise<void> {
    let next: ComputeJobRecord | null
    try {
      next = await this.options.transport.get(id, this.controller.signal)
    } catch {
      // Unreachable: keep what we know; the poll asks again while it runs.
      this.schedulePoll()
      return
    }
    if (this.disposed) return
    if (next === null) {
      if (this.records.delete(id)) this.emit()
      return
    }
    this.merge([next])
  }

  private runList(window: { since: string; until?: string }, listedAt: number | null, discovery = false): void {
    this.windows.push({ window, listedAt, discovery })
    void this.drainLists()
  }

  /** One list at a time, in the order asked. */
  private async drainLists(): Promise<void> {
    if (this.listing || this.disposed) return
    const next = this.windows.shift()
    if (!next) return
    const { window, listedAt, discovery } = next
    this.listing = true
    try {
      const records = await this.options.transport.list(window, this.controller.signal)
      if (this.disposed) return
      if (listedAt !== null) this.lastListedAt = Math.max(this.lastListedAt ?? 0, listedAt)
      this.merge(records)
    } catch {
      if (this.disposed) return
      // A failed open list is retried as a discovery from the window's start.
      if (this.lastListedAt === null && window.until === undefined) this.discoveryWanted = true
    } finally {
      this.listing = false
      if (discovery && this.discoveringIds) {
        for (const id of this.discoveringIds) if (!this.records.has(id)) this.rememberForeign(id)
        this.discoveringIds = null
      }
      // An id that arrived meanwhile and this list already returned needs no second look.
      for (const id of this.discoveryIds) if (this.records.has(id)) this.discoveryIds.delete(id)
      if (!this.disposed) {
        if (this.windows.length) void this.drainLists()
        this.scheduleFlush()
      }
    }
  }

  private rememberForeign(id: string): void {
    this.foreignIds.add(id)
    if (this.foreignIds.size > 256) this.foreignIds.delete(this.foreignIds.values().next().value!)
  }

  private merge(records: readonly ComputeJobRecord[]): void {
    let changed = false
    for (const record of records) {
      if (!record || typeof record.id !== "string") continue
      const previous = this.records.get(record.id)
      const next = foldJobRecord(previous, record)
      if (!previous || JSON.stringify(next) !== JSON.stringify(previous)) {
        this.records.set(record.id, next)
        changed = true
      }
    }
    if (changed) this.emit()
    this.schedulePoll()
  }

  private schedulePoll(): void {
    if (this.disposed || this.pollTimer !== null || this.activeIds().length === 0) return
    this.pollTimer = this.options.setTimer(() => {
      this.pollTimer = null
      const active = this.activeIds()
      if (active.length) this.queueRefresh(active)
      this.schedulePoll()
    }, this.options.pollIntervalMs)
  }

  private emit(): void {
    this.options.onChange(this.snapshot())
  }
}
