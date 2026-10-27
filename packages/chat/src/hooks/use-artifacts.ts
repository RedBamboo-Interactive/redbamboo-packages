import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from "react"
import type { Artifact, ArtifactLoader, ArtifactLoadParams } from "../lib/artifacts"
import { ArtifactsStore, type ArtifactsStatus } from "../lib/artifacts-store"

export interface UseArtifactsOptions {
  /** Identity of the conversation. Changing it discards everything held and starts over. */
  conversationKey: string | null | undefined
  /** Host read of `GET .../artifacts`. May change identity freely; the latest one is used. */
  load: ArtifactLoader
  /** Nothing is fetched while false (for example while the panel is closed). Re-enabling catches up with a delta. */
  enabled?: boolean
}

export interface ArtifactsState {
  /** Newest last occurrence first. */
  items: Artifact[]
  status: ArtifactsStatus
  error: string | null
  /**
   * Delta read for what changed since the last read. Hosts call it when a turn
   * settles, on a discussion event or on reconnect, never per stream token.
   * Concurrent calls coalesce into one in-flight read plus one trailing read.
   */
  refresh: () => Promise<void>
  /** Discard everything and load from scratch (the retry action). */
  reload: () => Promise<void>
}

export type { ArtifactLoadParams }

/** Per-conversation artifact list: paged initial load, then delta refreshes merged by key. */
export function useArtifacts({ conversationKey, load, enabled = true }: UseArtifactsOptions): ArtifactsState {
  const loadRef = useRef(load)
  loadRef.current = load
  const stableLoad = useCallback<ArtifactLoader>(params => loadRef.current(params), [])

  // A new conversation gets a new store, so nothing from the previous one can
  // render, even for the first frame.
  const store = useMemo(() => new ArtifactsStore(stableLoad), [conversationKey, stableLoad])
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => {
    store.setEnabled(enabled)
    return () => store.setEnabled(false)
  }, [store, enabled])

  const refresh = useCallback(() => store.refresh(), [store])
  const reload = useCallback(() => store.reload(), [store])

  return { items: snapshot.items, status: snapshot.status, error: snapshot.error, refresh, reload }
}
