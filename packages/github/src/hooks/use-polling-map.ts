import { useState, useRef, useCallback, useEffect } from "react"

interface UsePollingMapOptions<K, V> {
  fetchItem: (key: K) => Promise<V>
  isTerminal: (item: V) => boolean
  interval?: number
  resetKey?: string
}

export function usePollingMap<K extends string, V>({
  fetchItem,
  isTerminal,
  interval = 5000,
  resetKey,
}: UsePollingMapOptions<K, V>) {
  const [items, setItems] = useState<Map<K, V>>(new Map())
  const timers = useRef<Map<K, ReturnType<typeof setInterval>>>(new Map())
  const seqCounters = useRef<Map<K, number>>(new Map())

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
        const mySeq = (seqCounters.current.get(key) ?? 0) + 1
        seqCounters.current.set(key, mySeq)
        try {
          const result = await fetchItem(key)
          if (seqCounters.current.get(key) !== mySeq) return
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

  // Reset all timers and items when resetKey changes
  useEffect(() => {
    for (const timer of timers.current.values()) clearInterval(timer)
    timers.current.clear()
    seqCounters.current.clear()
    setItems(new Map())
  }, [resetKey])

  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearInterval(timer)
      timers.current.clear()
    }
  }, [])

  return { items, get, set, setAndPoll, startPolling }
}
