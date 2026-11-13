import { DurableTranscriptPager, type DurableTranscriptPagerResult } from "./durable-transcript-pager.ts"
import type { PersistedMessage } from "./rebuild-blocks.ts"
import { TranscriptAccumulator, type TranscriptCursor } from "./transcript-accumulator.ts"
import { isTranscriptPageResponse, toPersistedTranscriptPage, type TranscriptPageDirection, type TranscriptPageResponse } from "./transcript-page.ts"

export interface TranscriptPageRequest {
  /** Exclusive anchor for the page before the loaded window. */
  before?: string
  /** Exclusive anchor for the records after the loaded window. */
  after?: string
  limit: number
}

/**
 * The whole loaded window after one accepted page, for the host to install with
 * `accumulator.commitSnapshot(requestId, project(records), cursor)` inside its state update. A
 * window committed after a newer request began is refused by the accumulator as stale; the newer
 * window carries every record, so nothing is lost.
 */
export interface TranscriptWindow<TSession = unknown> {
  requestId: number
  direction: TranscriptPageDirection
  /** Every loaded durable record, in storage order; `rebuildBlocks` orders them canonically. */
  records: PersistedMessage[]
  cursor: TranscriptCursor | null
  hasEarlier: boolean
  /** The page just read, for its current session metadata. */
  response: TranscriptPageResponse<TSession>
}

export interface SessionTranscriptPagingOptions<TSession = unknown> {
  /** Reads `transcript-page` with the given cursor; rejects on HTTP errors. */
  fetchPage(request: TranscriptPageRequest): Promise<unknown>
  /** Called once per accepted page with the loaded window. */
  onWindow(window: TranscriptWindow<TSession>): void
  /** Soft raw-record target per page (RedCompute clamps to 1..500). */
  limit?: number
  /** True for an error meaning the cursor no longer applies, so paging restarts at the newest page. */
  isCursorRejected?(error: unknown): boolean
  accumulator?: TranscriptAccumulator
}

export type TranscriptPagingResult = "committed" | "none" | "superseded" | "failed"

export class TranscriptPagingError extends Error {
  readonly reason: string
  constructor(reason: string) {
    super(`The transcript page could not be used (${reason})`)
    this.name = "TranscriptPagingError"
    this.reason = reason
  }
}

/** RedCompute answers a cursor for an older epoch or another resource with these 409 codes. */
export function isTranscriptCursorRejected(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false
  const { status, code } = error as { status?: unknown; code?: unknown }
  return status === 409 && (code === "transcript_cursor_stale" || code === "transcript_cursor_mismatch")
}

type Operation = "newest" | "after" | "before"

const MAX_CATCH_UP_PAGES = 100

/**
 * One RedCompute session's durable transcript, read through `transcript-page`: the newest page to
 * start or after a reset, `after` pages to catch up (reconnect, gap, settle), `before` pages for
 * earlier history. It composes the shared {@link DurableTranscriptPager} (identity-keyed union of
 * storage-keyset pages, boundaries completed by the server) and {@link TranscriptAccumulator}
 * (live events above the window's watermark), adding no merge rules of its own.
 *
 * Operations run one at a time in arrival order; a second request of a kind that is already waiting
 * joins it. A stale or mismatched cursor, a page from another epoch or a page the pager refuses
 * restarts at the newest page. Framework-free so the order can be replayed deterministically.
 */
export class SessionTranscriptPaging<TSession = unknown> {
  readonly accumulator: TranscriptAccumulator
  private readonly pager = new DurableTranscriptPager()
  private readonly options: SessionTranscriptPagingOptions<TSession>
  private readonly limit: number
  private nextRequestId = 0
  private generation = 0
  private disposed = false
  private chain: Promise<unknown> = Promise.resolve()
  private readonly waiting = new Map<Operation, Promise<TranscriptPagingResult>>()
  private failure: unknown = null

  constructor(options: SessionTranscriptPagingOptions<TSession>) {
    this.options = options
    this.limit = options.limit ?? 500
    this.accumulator = options.accumulator ?? new TranscriptAccumulator()
  }

  /** Whether durable history exists before the oldest loaded record. */
  get hasEarlier(): boolean {
    return this.pager.current().hasEarlier
  }

  /** The error of the last failed read, cleared by the next accepted page. */
  get lastFailure(): unknown {
    return this.failure
  }

  /** Read the newest page; retains an already loaded prefix in the same epoch. */
  loadNewest(): Promise<TranscriptPagingResult> {
    return this.enqueue("newest", () => this.readNewest())
  }

  /** Read every durable record after the loaded window (the newest page when nothing is loaded yet). */
  catchUp(): Promise<TranscriptPagingResult> {
    return this.enqueue("after", () => this.readNewer())
  }

  /** Read the page before the loaded window. "none" when the window already starts the transcript. */
  loadEarlier(): Promise<TranscriptPagingResult> {
    return this.enqueue("before", () => this.readOlder())
  }

  /** Forget the loaded window; a read in flight is dropped when it lands. */
  reset(): void {
    ++this.generation
    this.pager.reset()
  }

  /** The session went away: nothing more is read or committed. */
  dispose(): void {
    this.disposed = true
    this.reset()
  }

  private enqueue(operation: Operation, task: () => Promise<TranscriptPagingResult>): Promise<TranscriptPagingResult> {
    const joined = this.waiting.get(operation)
    if (joined) return joined
    const run = this.chain.then(() => {
      this.waiting.delete(operation)
      return this.disposed ? "superseded" as const : task()
    })
    this.waiting.set(operation, run)
    this.chain = run.catch(() => {})
    return run
  }

  private begin(): { generation: number; requestId: number } {
    const requestId = ++this.nextRequestId
    this.accumulator.startSnapshot(requestId)
    return { generation: this.generation, requestId }
  }

  private current(generation: number): boolean {
    return !this.disposed && generation === this.generation
  }

  private async fetch(request: TranscriptPageRequest): Promise<{ ok: true; response: TranscriptPageResponse<TSession> } | { ok: false; error: unknown }> {
    try {
      const raw = await this.options.fetchPage(request)
      if (!isTranscriptPageResponse(raw)) return { ok: false, error: new TranscriptPagingError("invalid-response") }
      return { ok: true, response: raw as TranscriptPageResponse<TSession> }
    } catch (error) {
      return { ok: false, error }
    }
  }

  private cursorRejected(error: unknown): boolean {
    return (this.options.isCursorRejected ?? isTranscriptCursorRejected)(error)
  }

  private fail(error: unknown): TranscriptPagingResult {
    this.failure = error
    return "failed"
  }

  /** The anchor no longer describes the server's transcript: start again from the newest page. */
  private restart(): Promise<TranscriptPagingResult> {
    this.pager.reset()
    return this.readNewest()
  }

  private emit(requestId: number, direction: TranscriptPageDirection, result: DurableTranscriptPagerResult, response: TranscriptPageResponse<TSession>): void {
    this.failure = null
    this.options.onWindow({
      requestId,
      direction,
      records: result.records,
      cursor: result.epoch && result.throughSequence !== null
        ? { epoch: result.epoch, throughSequence: result.throughSequence }
        : null,
      hasEarlier: result.hasEarlier,
      response,
    })
  }

  private async readNewest(): Promise<TranscriptPagingResult> {
    const { generation, requestId } = this.begin()
    this.pager.startNewestPage(requestId)
    const read = await this.fetch({ limit: this.limit })
    if (!this.current(generation)) return "superseded"
    if (!read.ok) return this.fail(read.error)
    const result = this.pager.commitNewestPage(requestId, toPersistedTranscriptPage(read.response.messages, read.response.page))
    if (!result.accepted)
      return result.rejection === "stale-request" ? "superseded" : this.fail(new TranscriptPagingError(result.rejection ?? "rejected"))
    this.emit(requestId, "newest", result, read.response)
    return "committed"
  }

  private async readNewer(): Promise<TranscriptPagingResult> {
    for (let pages = 0; pages < MAX_CATCH_UP_PAGES; pages++) {
      const { generation, requestId } = this.begin()
      const anchor = this.pager.startNewerPage(requestId)
      if (!anchor) return this.readNewest()
      const read = await this.fetch({ after: anchor, limit: this.limit })
      if (!this.current(generation)) return "superseded"
      if (!read.ok) return this.cursorRejected(read.error) ? this.restart() : this.fail(read.error)
      const result = this.pager.appendNewerPage(requestId, anchor, toPersistedTranscriptPage(read.response.messages, read.response.page))
      if (!result.accepted) {
        if (result.rejection === "stale-request" || result.rejection === "stale-anchor") return "superseded"
        // Another epoch, or a page that cannot be verified: an unknown hole after the window.
        return this.restart()
      }
      this.emit(requestId, "after", result, read.response)
      if (!result.hasLater) return "committed"
    }
    return "committed"
  }

  private async readOlder(): Promise<TranscriptPagingResult> {
    if (!this.pager.current().hasEarlier) return "none"
    const { generation, requestId } = this.begin()
    const anchor = this.pager.startOlderPage(requestId)
    if (!anchor) return "none"
    const read = await this.fetch({ before: anchor, limit: this.limit })
    if (!this.current(generation)) return "superseded"
    if (!read.ok) return this.cursorRejected(read.error) ? this.restart() : this.fail(read.error)
    const result = this.pager.prependOlderPage(requestId, anchor, toPersistedTranscriptPage(read.response.messages, read.response.page))
    if (!result.accepted) {
      if (result.rejection === "stale-request" || result.rejection === "stale-anchor") return "superseded"
      if (result.rejection === "stale-epoch") return this.restart()
      return this.fail(new TranscriptPagingError(result.rejection ?? "rejected"))
    }
    this.emit(requestId, "before", result, read.response)
    return "committed"
  }
}
