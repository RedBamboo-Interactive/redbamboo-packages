import { mergeArtifacts, sortArtifacts, type Artifact, type ArtifactLoader, type ArtifactPage } from "./artifacts.ts"

export type ArtifactsStatus = "idle" | "loading" | "ready" | "error"

export interface ArtifactsSnapshot {
  items: Artifact[]
  status: ArtifactsStatus
  /** Set when a load failed. With `status: "ready"` it is a failed refresh over data that is still shown. */
  error: string | null
  epoch: string | null
  throughSequence: number | null
}

const PAGE_LIMIT = 500
/** A response from a different epoch mid-load restarts the load; give up after this many restarts. */
const MAX_EPOCH_RESTARTS = 3
/** Safety bound against a cursor that never ends. */
const MAX_PAGES = 200

const EMPTY: ArtifactsSnapshot = { items: [], status: "idle", error: null, epoch: null, throughSequence: null }

class EpochChanged extends Error {}

function describeError(error: unknown): string {
  return error instanceof Error && error.message ? error.message : "Could not load artifacts"
}

/**
 * Framework-free artifact loader for one conversation. `useArtifacts` binds it
 * to React; the logic lives here so the history/live overlap and the epoch
 * reset are covered by plain node tests.
 *
 * - The initial load pages through `nextCursor` (limit 500) until done.
 * - `refresh()` is a delta read (`sinceSequence = throughSequence`) merged by
 *   `key`. Concurrent refreshes coalesce: one in flight, one trailing.
 * - A response whose `epoch` differs from the held one discards everything and
 *   loads from scratch (the conversation was cleared).
 * - `throughSequence` is the lowest watermark seen while loading, so items that
 *   land between pages are re-read by the next delta instead of missed; the
 *   merge by `key` makes that overlap harmless.
 */
export class ArtifactsStore {
  private snapshot: ArtifactsSnapshot = EMPTY
  private readonly listeners = new Set<() => void>()
  private generation = 0
  private running: Promise<void> | null = null
  private trailing = false
  private enabled = false
  private disposed = false

  private load: ArtifactLoader

  constructor(load: ArtifactLoader) {
    this.load = load
  }

  getSnapshot = (): ArtifactsSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setLoader(load: ArtifactLoader): void {
    this.load = load
  }

  /**
   * Enable or disable loading. Enabling an idle store loads; enabling a loaded
   * one catches up with a delta. Disabling abandons whatever is in flight (its
   * result is discarded) and drops a half-finished initial load, so a later
   * enable never mistakes partial data for a complete list.
   */
  setEnabled(enabled: boolean): void {
    if (this.disposed || this.enabled === enabled) return
    this.enabled = enabled
    if (enabled) {
      void this.refresh()
      return
    }
    this.generation++
    this.trailing = false
    this.running = null
    if (this.snapshot.status === "loading") this.set(EMPTY)
  }

  dispose(): void {
    this.disposed = true
    this.generation++
    this.listeners.clear()
  }

  /**
   * Delta read (or the initial load when nothing has loaded). Resolves when
   * the read that covers this request has finished. Never rejects: failures
   * land in the snapshot.
   */
  refresh(): Promise<void> {
    if (this.disposed || !this.enabled) return Promise.resolve()
    if (this.running) {
      this.trailing = true
      return this.running
    }
    return this.start()
  }

  /** Resolves when no read is in flight. */
  idle(): Promise<void> {
    return this.running ?? Promise.resolve()
  }

  /** Throw away everything held and load from scratch. */
  reload(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    this.generation++
    this.trailing = false
    this.running = null
    this.set(EMPTY)
    return this.enabled ? this.start() : Promise.resolve()
  }

  private start(): Promise<void> {
    const generation = this.generation
    const run = (async () => {
      do {
        this.trailing = false
        await this.pass(generation)
        if (generation !== this.generation) return
      } while (this.trailing && this.snapshot.status !== "error")
    })().finally(() => {
      if (this.running === run) this.running = null
    })
    this.running = run
    return run
  }

  private set(next: ArtifactsSnapshot): void {
    this.snapshot = next
    for (const listener of [...this.listeners]) listener()
  }

  private async pass(generation: number): Promise<void> {
    const held = this.snapshot
    const delta = held.epoch !== null && held.throughSequence !== null
    try {
      if (delta) {
        try {
          await this.readDelta(generation, held.epoch!, held.throughSequence!)
        } catch (error) {
          if (!(error instanceof EpochChanged)) throw error
          if (generation !== this.generation) return
          this.set(EMPTY)
          await this.readInitial(generation)
        }
      } else {
        await this.readInitial(generation)
      }
    } catch (error) {
      if (generation !== this.generation) return
      // A failed initial load must not leave a partial list that a later delta
      // would mistake for a complete one; a failed delta keeps what is shown.
      this.set(this.snapshot.status === "loading"
        ? { ...EMPTY, status: "error", error: describeError(error) }
        : { ...this.snapshot, status: "ready", error: describeError(error) })
    }
  }

  private async readInitial(generation: number): Promise<void> {
    for (let restart = 0; restart <= MAX_EPOCH_RESTARTS; restart++) {
      if (generation !== this.generation) return
      this.set({ ...EMPTY, status: "loading" })
      let items: Artifact[] = []
      let epoch: string | null = null
      let through = Number.POSITIVE_INFINITY
      let cursor: string | undefined
      let restarted = false
      for (let pages = 0; pages < MAX_PAGES; pages++) {
        const page: ArtifactPage = await this.load({ limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) })
        if (generation !== this.generation) return
        if (epoch !== null && page.epoch !== epoch) { restarted = true; break }
        epoch = page.epoch
        through = Math.min(through, page.throughSequence)
        items = mergeArtifacts(items, page.items)
        cursor = page.page.nextCursor ?? undefined
        // Show what has arrived so far; a long conversation fills in page by page.
        this.set({ items, status: "loading", error: null, epoch, throughSequence: through })
        if (!cursor) break
      }
      if (restarted) continue
      this.set({ items, status: "ready", error: null, epoch, throughSequence: Number.isFinite(through) ? through : 0 })
      return
    }
    throw new Error("The conversation changed while its artifacts were loading")
  }

  private async readDelta(generation: number, epoch: string, since: number): Promise<void> {
    let items = this.snapshot.items
    let through = since
    let cursor: string | undefined
    let lowest = Number.POSITIVE_INFINITY
    for (let pages = 0; pages < MAX_PAGES; pages++) {
      const page: ArtifactPage = await this.load({ sinceSequence: since, limit: PAGE_LIMIT, ...(cursor ? { cursor } : {}) })
      if (generation !== this.generation) return
      if (page.epoch !== epoch) throw new EpochChanged()
      items = mergeArtifacts(items, page.items)
      lowest = Math.min(lowest, page.throughSequence)
      through = Math.max(through, lowest)
      cursor = page.page.nextCursor ?? undefined
      if (!cursor) break
    }
    this.set({ items: sortArtifacts(items), status: "ready", error: null, epoch, throughSequence: through })
  }
}
