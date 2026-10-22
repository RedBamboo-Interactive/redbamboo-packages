import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { EntityCardDetail, EntityCardEntity, EntityCardVisual } from "./entity-card"
import {
  itemMatchesReference,
  mergeEntityPickerSource,
  needsResolve,
  readResolution,
  retryDelay,
  settleResolution,
  type ResolutionEntry,
} from "./entity-picker-core"

/** One pickable entity, already projected into the canonical entity-card shape by the host. */
export interface EntityPickerItem {
  entity: EntityCardEntity
  /** Optional secondary identifier. Stored references may use the slug instead of the id. */
  slug?: string
  visual?: EntityCardVisual
  subtitle?: string
  /** Compact facts shown under the name in picker rows. */
  details?: readonly EntityCardDetail[]
  /** Canonical entity URL. When present, the selected card opens it as an inspect action. */
  href?: string
  /** Short audio clip the picker can play inline, for example a voice or sound sample. */
  previewAudioUrl?: string
  /** Host-owned trailing marks such as a system lock. */
  trailing?: ReactNode
}

export interface EntityPickerSearchRequest {
  /** Entity type slug, for example `agent`. */
  type: string
  /** Trimmed free text. Empty means "the default listing for this type". */
  query: string
  limit: number
}

export interface EntityPickerResolveRequest {
  type: string
  /** Stored reference, either an entity id or a slug. */
  id: string
}

/**
 * Host bridge for entity references. The host performs every read with the
 * caller's own session, so authorization and confidentiality stay its concern;
 * the design system only owns the async lifecycle and the picker anatomy.
 */
export interface EntityPickerSource {
  search(request: EntityPickerSearchRequest, signal: AbortSignal): Promise<readonly EntityPickerItem[]>
  /**
   * Resolves one stored reference. Return null only for an authoritative answer
   * (not found, forbidden, or another type). Throw for transient failures: the
   * field keeps showing what it had and retries.
   */
  resolve(request: EntityPickerResolveRequest, signal: AbortSignal): Promise<EntityPickerItem | null>
  /** Optional invalidation. Call `onChange` whenever entities of `type` may have changed. */
  subscribe?(type: string, onChange: () => void): () => void
}

/**
 * Per-field override: any subset of the methods. The rest come from the nearest
 * `EntityPickerProvider`. With no provider, a missing `resolve` lists the type
 * through `search` and matches the reference.
 */
export type EntityPickerSourceOverride = Partial<EntityPickerSource>

const EntityPickerContext = createContext<EntityPickerSource | null>(null)

export interface EntityPickerProviderProps {
  source: EntityPickerSource
  children: ReactNode
}

export function EntityPickerProvider({ source, children }: EntityPickerProviderProps) {
  return (
    <EntityPickerContext.Provider value={source}>
      {children}
    </EntityPickerContext.Provider>
  )
}

/**
 * The source a field uses: the nearest provider, with any per-field override
 * methods taking precedence. Override methods are read at call time, so inline
 * functions are fine; only adding or removing a method changes the identity.
 * Without an override this is the provider itself. Null when nothing can search.
 */
export function useEntityPickerSource(override?: EntityPickerSourceOverride | null): EntityPickerSource | null {
  const provided = useContext(EntityPickerContext)
  const latest = useRef(override)
  latest.current = override
  const hasOverride = !!override
  const hasSearch = !!override?.search
  const hasResolve = !!override?.resolve
  const hasSubscribe = !!override?.subscribe
  return useMemo(
    () => (hasOverride ? mergeEntityPickerSource(provided, () => latest.current) : provided),
    // The has* flags stand in for `override`, which is read through `latest`.
    [provided, hasOverride, hasSearch, hasResolve, hasSubscribe],
  )
}

/** Whether a stored reference (id or slug) points at this item. */
export function entityPickerItemMatches(item: EntityPickerItem, reference: string | null | undefined): boolean {
  return itemMatchesReference(item, reference)
}

function isAbort(cause: unknown) {
  return typeof DOMException !== "undefined" && cause instanceof DOMException && cause.name === "AbortError"
}

/** Re-renders whenever the host reports a change for `type`. */
function useSourceRevision(source: EntityPickerSource | null, type: string): number {
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!source?.subscribe || !type) return
    return source.subscribe(type, () => setRevision((value) => value + 1))
  }, [source, type])
  return revision
}

export type EntityPickerSearchStatus = "idle" | "loading" | "ready" | "error" | "unavailable"

export interface EntityPickerSearchState {
  items: readonly EntityPickerItem[]
  status: EntityPickerSearchStatus
  error?: string
}

/**
 * Runs a host search. Earlier results stay visible while a refined query loads,
 * so typing does not flash an empty list.
 */
export function useEntityPickerSearch({
  type,
  query,
  limit = 500,
  enabled = true,
  debounceMs = 150,
  source: override,
}: {
  type: string
  query: string
  limit?: number
  enabled?: boolean
  debounceMs?: number
  source?: EntityPickerSourceOverride | null
}): EntityPickerSearchState {
  const source = useEntityPickerSource(override)
  const revision = useSourceRevision(enabled ? source : null, type)
  const trimmed = query.trim()
  const [state, setState] = useState<EntityPickerSearchState>({ items: [], status: "idle" })
  const firstRun = useRef(true)
  const listedQuery = useRef("")

  useEffect(() => {
    if (!enabled) {
      firstRun.current = true
      // A closed picker reopens on the plain listing; never flash an old refinement.
      if (listedQuery.current) setState({ items: [], status: "idle" })
      return
    }
    if (!source) {
      setState({ items: [], status: "unavailable" })
      return
    }
    const controller = new AbortController()
    const run = () => {
      setState((previous) => ({ items: previous.items, status: "loading" }))
      Promise.resolve()
        .then(() => source.search({ type, query: trimmed, limit }, controller.signal))
        .then((items) => {
          if (controller.signal.aborted) return
          listedQuery.current = trimmed
          setState({ items, status: "ready" })
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted || isAbort(cause)) return
          setState({
            items: [],
            status: "error",
            error: cause instanceof Error ? cause.message : "Could not load entities",
          })
        })
    }
    // The opening listing loads at once; refinements wait for typing to settle.
    const immediate = firstRun.current || !trimmed || debounceMs <= 0
    firstRun.current = false
    const timer = immediate ? undefined : setTimeout(run, debounceMs)
    if (immediate) run()
    return () => {
      if (timer !== undefined) clearTimeout(timer)
      controller.abort()
    }
  }, [debounceMs, enabled, limit, revision, source, trimmed, type])

  return state
}

export type EntityPickerResolution =
  | { status: "loading" }
  | { status: "resolved"; item: EntityPickerItem }
  | { status: "missing" }
  | { status: "error"; error: string }

export interface EntityPickerResolutionState {
  /** Current view of one reference. A resolved item stays visible while it revalidates. */
  get(reference: string): EntityPickerResolution
  /** Retry failed resolves now instead of waiting for the backoff. */
  retry(): void
}

/**
 * Resolves stored references to items, stale-while-revalidate. When the host
 * reports a change, the last resolved item stays on screen until the new answer
 * lands. Only an authoritative null from the host means missing; failures keep
 * the previous answer and retry with backoff. `known` items (initial data, or
 * items just picked) render immediately.
 */
export function useEntityPickerResolution({
  type,
  references,
  known = [],
  source: override,
}: {
  type: string
  references: readonly string[]
  known?: readonly EntityPickerItem[]
  source?: EntityPickerSourceOverride | null
}): EntityPickerResolutionState {
  const source = useEntityPickerSource(override)
  const revision = useSourceRevision(source, type)
  // One identity per (source, type, revision). Answers from an older epoch stay
  // displayable but are resolved again.
  const epoch = useMemo(() => ({ source, type, revision }), [source, type, revision])
  const [entries, setEntries] = useState<ReadonlyMap<string, ResolutionEntry<EntityPickerItem>>>(() => new Map())
  const entriesRef = useRef(entries)
  entriesRef.current = entries
  const [attempt, setAttempt] = useState(0)
  const key = references.join("\u0000")

  useEffect(() => {
    if (!source || !type) return
    const pending = references.filter((reference) => needsResolve(entriesRef.current.get(reference), epoch))
    if (pending.length === 0) return
    const controller = new AbortController()
    for (const reference of pending) {
      Promise.resolve()
        .then(() => source.resolve({ type, id: reference }, controller.signal))
        .then(
          (item) => ({ item }),
          (cause: unknown) => {
            if (controller.signal.aborted || isAbort(cause)) return null
            return { error: cause instanceof Error ? cause.message : "Could not load this entity" }
          },
        )
        .then((outcome) => {
          if (!outcome || controller.signal.aborted) return
          setEntries((previous) => {
            const next = new Map(previous)
            next.set(reference, settleResolution(previous.get(reference), epoch, outcome))
            return next
          })
        })
    }
    return () => controller.abort()
    // `references` is captured through `key`; entries are read through the ref.
  }, [attempt, epoch, key, source, type])

  // Failed references retry with backoff; the next success resets the count.
  const nextRetry = references.reduce<number | null>((soonest, reference) => {
    const entry = entries.get(reference)
    if (!entry || entry.failures === 0) return soonest
    const delay = retryDelay(entry.failures)
    return soonest === null ? delay : Math.min(soonest, delay)
  }, null)
  useEffect(() => {
    if (nextRetry === null) return
    const timer = setTimeout(() => setAttempt((value) => value + 1), nextRetry)
    return () => clearTimeout(timer)
  }, [nextRetry, entries])

  const retry = useCallback(() => setAttempt((value) => value + 1), [])

  return {
    get: (reference: string) => readResolution(
      entries.get(reference),
      known.find((item) => itemMatchesReference(item, reference)),
      !!source,
    ),
    retry,
  }
}
