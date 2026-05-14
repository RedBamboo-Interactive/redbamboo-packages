import { useMemo, useCallback, useRef } from "react"

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

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const onLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify(layout))
        } catch { /* ignore */ }
      }, 300)
    },
    [key],
  )

  return { savedLayout, onLayoutChanged }
}

export { useLayoutPersistence }
export type { UseLayoutPersistenceReturn }
