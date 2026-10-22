import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react"
import type { EntityCardDetail, EntityCardEntity, EntityCardVisual } from "./entity-card"

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
  /** Resolves one stored reference. Return null for a missing or inaccessible entity. */
  resolve(request: EntityPickerResolveRequest, signal: AbortSignal): Promise<EntityPickerItem | null>
  /** Optional invalidation. Call `onChange` whenever entities of `type` may have changed. */
  subscribe?(type: string, onChange: () => void): () => void
}

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

/** The nearest host source, or the explicit override. Null when no host provides one. */
export function useEntityPickerSource(override?: EntityPickerSource | null): EntityPickerSource | null {
  const provided = useContext(EntityPickerContext)
  return override ?? provided
}

/** Whether a stored reference (id or slug) points at this item. */
export function entityPickerItemMatches(item: EntityPickerItem, reference: string | null | undefined): boolean {
  return !!reference && (item.entity.id === reference || item.slug === reference)
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
  source?: EntityPickerSource | null
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

/**
 * Resolves stored references to items. `known` items (initial data, or items
 * just picked) render immediately and are not re-fetched until the host reports
 * a change for the type.
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
  source?: EntityPickerSource | null
}): (reference: string) => EntityPickerResolution {
  const source = useEntityPickerSource(override)
  const revision = useSourceRevision(source, type)
  const [results, setResults] = useState<{ revision: number; map: Map<string, EntityPickerItem | null> }>(
    () => ({ revision, map: new Map() }),
  )
  const map = results.revision === revision ? results.map : null
  const key = references.join("\u0000")

  useEffect(() => {
    if (!source || !type) return
    const current = results.revision === revision ? results.map : new Map<string, EntityPickerItem | null>()
    const pending = references.filter((reference) => !current.has(reference))
    if (pending.length === 0) {
      if (current !== results.map) setResults({ revision, map: current })
      return
    }
    const controller = new AbortController()
    Promise.all(pending.map((reference) =>
      Promise.resolve()
        .then(() => source.resolve({ type, id: reference }, controller.signal))
        .catch((cause: unknown) => {
          if (isAbort(cause)) throw cause
          return null
        })
        .then((item) => [reference, item] as const)))
      .then((entries) => {
        if (controller.signal.aborted) return
        setResults((previous) => {
          const next = new Map(previous.revision === revision ? previous.map : [])
          for (const [reference, item] of entries) next.set(reference, item)
          return { revision, map: next }
        })
      })
      .catch(() => {})
    return () => controller.abort()
    // `results` is read only to skip work already done for this revision.
  }, [key, revision, source, type])

  return (reference: string) => {
    const resolved = map?.get(reference)
    if (resolved) return { status: "resolved", item: resolved }
    const fallback = known.find((item) => entityPickerItemMatches(item, reference))
    if (fallback) return { status: "resolved", item: fallback }
    if (resolved === null || !source) return { status: "missing" }
    return { status: "loading" }
  }
}
