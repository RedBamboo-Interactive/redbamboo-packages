import { useSyncExternalStore } from "react"

const LOCAL_STORE_CHANGED_EVENT = "redbamboo:local-store-changed"

export interface LocalStore<T extends Record<string, unknown>> {
  get(): T
  set(partial: Partial<T>): void
  subscribe(callback: () => void): () => void
  getSnapshot(): T
}

export function createLocalStore<T extends Record<string, unknown>>(
  key: string,
  defaults: T,
): LocalStore<T> {
  let cached: T | undefined
  const listeners = new Set<() => void>()
  const source = {}

  function notify() {
    for (const fn of listeners) fn()
  }

  function get(): T {
    if (cached) return cached
    const raw = localStorage.getItem(key)
    if (!raw) {
      cached = { ...defaults }
      return cached
    }
    try {
      cached = { ...defaults, ...JSON.parse(raw) } as T
    } catch {
      cached = { ...defaults }
    }
    return cached!
  }

  function set(partial: Partial<T>) {
    const next = { ...get(), ...partial }
    localStorage.setItem(key, JSON.stringify(next))
    cached = next
    notify()
    window.dispatchEvent(new CustomEvent(LOCAL_STORE_CHANGED_EVENT, { detail: { key, source } }))
  }

  function subscribe(callback: () => void): () => void {
    listeners.add(callback)

    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
        cached = undefined
        notify()
      }
    }
    const onLocalChange = (e: Event) => {
      const detail = (e as CustomEvent<{ key?: string; source?: object }>).detail
      if (detail?.key === key && detail.source !== source) {
        cached = undefined
        notify()
      }
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener(LOCAL_STORE_CHANGED_EVENT, onLocalChange)

    return () => {
      listeners.delete(callback)
      window.removeEventListener("storage", onStorage)
      window.removeEventListener(LOCAL_STORE_CHANGED_EVENT, onLocalChange)
    }
  }

  return { get, set, subscribe, getSnapshot: get }
}

export function useLocalStore<T extends Record<string, unknown>>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
