import { useState, useRef, useCallback, useEffect } from "react"

interface UsePollingMapOptions<K, V> {
  fetchItem: (key: K) => Promise<V>
  isTerminal: (item: V) => boolean
  interval?: number
}

export function usePollingMap<K extends string, V>({
  fetchItem,
  isTerminal,
  interval = 5000,
}: UsePollingMapOptions<K, V>) {
  const [items, setItems] = useState<Map<K, V>>(new Map())
  const timers = useRef<Map<K, ReturnType<typeof setInterval>>>(new Map())

  const get = useCallback((key: K): V | undefined => items.get(key), [items])

  const set = useCallback((key: K, value: V) => {
    setItems((prev) => {
      const next = new Map(prev)
      next.set(key, value)
      return next
    })
  }, [])

  const startPolling = useCallback(
    (key: K) => {
      if (timers.current.has(key)) return
      const timer = setInterval(async () => {
        try {
          const result = await fetchItem(key)
          setItems((prev) => {
            const next = new Map(prev)
            next.set(key, result)
            return next
          })
          if (isTerminal(result)) {
            clearInterval(timer)
            timers.current.delete(key)
          }
        } catch {
          clearInterval(timer)
          timers.current.delete(key)
        }
      }, interval)
      timers.current.set(key, timer)
    },
    [fetchItem, isTerminal, interval],
  )

  const setAndPoll = useCallback(
    (key: K, initial: V) => {
      set(key, initial)
      startPolling(key)
    },
    [set, startPolling],
  )

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearInterval(timer)
      timers.current.clear()
    }
  }, [])

  return { items, get, set, setAndPoll, startPolling }
}
