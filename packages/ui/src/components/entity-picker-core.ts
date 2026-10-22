// Framework-free rules behind the entity picker hooks, kept separate so they
// can be tested without a DOM. Types are structural to avoid importing React.

export interface EntityPickerCoreItem {
  entity: { id: string; typeSlug: string; name: string }
  slug?: string
}

export interface EntityPickerCoreSource<Item extends EntityPickerCoreItem> {
  search(request: { type: string; query: string; limit: number }, signal: AbortSignal): Promise<readonly Item[]>
  resolve(request: { type: string; id: string }, signal: AbortSignal): Promise<Item | null>
  subscribe?(type: string, onChange: () => void): () => void
}

/** Rows a search-only source lists when it has to resolve a reference itself. */
export const ENTITY_PICKER_RESOLVE_SCAN_LIMIT = 500

export function itemMatchesReference(item: EntityPickerCoreItem, reference: string | null | undefined): boolean {
  return !!reference && (item.entity.id === reference || item.slug === reference)
}

/** Resolves a reference by listing the type, for sources that only implement `search`. */
export async function resolveFromSearch<Item extends EntityPickerCoreItem>(
  search: EntityPickerCoreSource<Item>["search"],
  request: { type: string; id: string },
  signal: AbortSignal,
): Promise<Item | null> {
  const items = await search({ type: request.type, query: "", limit: ENTITY_PICKER_RESOLVE_SCAN_LIMIT }, signal)
  return items.find((item) => item.entity.id === request.id)
    ?? items.find((item) => itemMatchesReference(item, request.id))
    ?? null
}

/**
 * Combines a per-field override with the host provider, method by method.
 * `read` returns the latest override, so callers can pass inline functions
 * without changing the merged source's identity on every render.
 * Returns null when no search is available at all.
 */
export function mergeEntityPickerSource<Item extends EntityPickerCoreItem>(
  provided: EntityPickerCoreSource<Item> | null | undefined,
  read: () => Partial<EntityPickerCoreSource<Item>> | null | undefined,
): EntityPickerCoreSource<Item> | null {
  const initial = read()
  if (!initial) return provided ?? null
  const search: EntityPickerCoreSource<Item>["search"] | undefined = initial.search
    ? (request, signal) => (read()?.search ?? provided!.search.bind(provided))(request, signal)
    : provided ? (request, signal) => provided.search(request, signal) : undefined
  if (!search) return null
  const resolve: EntityPickerCoreSource<Item>["resolve"] = initial.resolve
    ? (request, signal) => {
        const override = read()?.resolve
        if (override) return override(request, signal)
        return provided ? provided.resolve(request, signal) : resolveFromSearch(search, request, signal)
      }
    : provided
      ? (request, signal) => provided.resolve(request, signal)
      : (request, signal) => resolveFromSearch(search, request, signal)
  const subscribe = initial.subscribe
    ? (type: string, onChange: () => void) => (read()?.subscribe ?? provided?.subscribe?.bind(provided) ?? (() => () => {}))(type, onChange)
    : provided?.subscribe
      ? (type: string, onChange: () => void) => provided.subscribe!(type, onChange)
      : undefined
  return subscribe ? { search, resolve, subscribe } : { search, resolve }
}

// ── Reference resolution state ───────────────────────────────────────────────

/**
 * What is known about one stored reference. `item` is the last authoritative
 * answer: an item, null for missing/inaccessible, or undefined if none yet.
 * `epoch` identifies the source revision that answer belongs to.
 */
export interface ResolutionEntry<Item> {
  item?: Item | null
  epoch: unknown
  failures: number
  error?: string
}

export type ResolutionOutcome<Item> = { item: Item | null } | { error: string }

/** True when the entry is absent, from an older revision, or failed. */
export function needsResolve(entry: ResolutionEntry<unknown> | undefined, epoch: unknown): boolean {
  return !entry || entry.epoch !== epoch || entry.failures > 0
}

/**
 * Folds one resolve outcome into the entry. A failure never replaces the last
 * authoritative answer: a resolved item stays visible and is retried later.
 */
export function settleResolution<Item>(
  previous: ResolutionEntry<Item> | undefined,
  epoch: unknown,
  outcome: ResolutionOutcome<Item>,
): ResolutionEntry<Item> {
  if ("error" in outcome) {
    return {
      item: previous?.item,
      epoch: previous?.epoch ?? null,
      failures: (previous?.failures ?? 0) + 1,
      error: outcome.error,
    }
  }
  return { item: outcome.item, epoch, failures: 0 }
}

export type EntityPickerCoreResolution<Item> =
  | { status: "loading" }
  | { status: "resolved"; item: Item }
  | { status: "missing" }
  | { status: "error"; error: string }

/**
 * Stale-while-revalidate read: the last resolved item wins, then a known item,
 * then an authoritative miss, then an error. Loading only when nothing is known.
 */
export function readResolution<Item>(
  entry: ResolutionEntry<Item> | undefined,
  known: Item | undefined,
  hasSource: boolean,
): EntityPickerCoreResolution<Item> {
  if (entry?.item) return { status: "resolved", item: entry.item }
  if (known) return { status: "resolved", item: known }
  if (entry?.item === null) return { status: "missing" }
  if (!hasSource) return { status: "missing" }
  if (entry && entry.failures > 0) return { status: "error", error: entry.error ?? "Could not load this entity" }
  return { status: "loading" }
}

/** Backoff for retrying failed resolves: 1 s, 2 s, 4 s ... capped at 30 s. */
export function retryDelay(failures: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, failures - 1))
}

// ── Labels ───────────────────────────────────────────────────────────────────

/** Human singular label for a type slug: `voice-preset` → `voice preset`. */
export function entityTypeLabel(typeSlug: string): string {
  return typeSlug.replace(/[-_]+/g, " ").trim() || "entity"
}

/** Plain English plural for a type label: agent → agents, category → categories. */
export function pluralizeLabel(label: string): string {
  if (/[^aeiou]y$/i.test(label)) return `${label.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/i.test(label)) return `${label}es`
  return `${label}s`
}
