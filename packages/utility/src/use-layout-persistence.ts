import { useMemo, useCallback } from "react"

interface UseLayoutPersistenceReturn {
  savedLayout: Record<string, number> | undefined
  onLayoutChanged: (layout: Record<string, number>) => void
}

function useLayoutPersistence(key: string): UseLayoutPersistenceReturn {
  const savedLayout = useMemo(() => {
    try {
      const raw = localStorage.getItem(key)
      return raw ? JSON.parse(raw) : undefined
    } catch {
      return undefined
    }
  }, [key])

  const onLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      try {
        localStorage.setItem(key, JSON.stringify(layout))
      } catch { /* ignore */ }
    },
    [key],
  )

  return { savedLayout, onLayoutChanged }
}

export { useLayoutPersistence }
export type { UseLayoutPersistenceReturn }
