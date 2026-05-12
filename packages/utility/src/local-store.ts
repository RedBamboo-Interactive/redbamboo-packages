import { useSyncExternalStore } from "react"

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
  }

  function subscribe(callback: () => void): () => void {
    listeners.add(callback)

    const onStorage = (e: StorageEvent) => {
      if (e.key === key) {
        cached = undefined
        notify()
      }
    }
    window.addEventListener("storage", onStorage)

    return () => {
      listeners.delete(callback)
      window.removeEventListener("storage", onStorage)
    }
  }

  return { get, set, subscribe, getSnapshot: get }
}

export function useLocalStore<T extends Record<string, unknown>>(store: LocalStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
