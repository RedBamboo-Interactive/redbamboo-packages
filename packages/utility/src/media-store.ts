import { useSyncExternalStore } from "react"

export interface MediaStore {
  subscribe: (cb: () => void) => () => void
  getSnapshot: () => boolean
}

export function createMediaStore(query: string): MediaStore {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return {
      subscribe: () => () => {},
      getSnapshot: () => false,
    }
  }

  const mql = window.matchMedia(query)
  let current = mql.matches

  const subscribe = (cb: () => void) => {
    const handler = (e: MediaQueryListEvent) => { current = e.matches; cb() }
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }
  const getSnapshot = () => current

  return { subscribe, getSnapshot }
}

export function useMediaQuery(store: MediaStore): boolean {
  return useSyncExternalStore(store.subscribe, store.getSnapshot)
}
