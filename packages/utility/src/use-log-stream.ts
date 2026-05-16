import { useState, useEffect, useCallback, useRef } from "react"
import type { RemoteConnectionStore } from "./remote-connection"
import type { LogEntry, LogFilter, LogsResponse } from "./log-types"
import { createWebSocket } from "./create-websocket"

export interface UseLogStreamOptions {
  store?: RemoteConnectionStore
  logsEndpoint?: string
  wsEndpoint?: string
  maxEntries?: number
  autoConnect?: boolean
}

export interface UseLogStreamReturn {
  entries: LogEntry[]
  connected: boolean
  paused: boolean
  setPaused: (paused: boolean) => void
  errorCount: number
  warnCount: number
  loading: boolean
  error: string | null
  clear: () => Promise<void>
  refresh: (filter?: LogFilter) => Promise<void>
}

export function useLogStream(opts?: UseLogStreamOptions): UseLogStreamReturn {
  const maxEntries = opts?.maxEntries ?? 2000
  const autoConnect = opts?.autoConnect ?? true

  const [entries, setEntries] = useState<LogEntry[]>([])
  const [connected, setConnected] = useState(false)
  const [paused, setPaused] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const activeRef = useRef(true)
  const seenIds = useRef(new Set<string>())
  const pausedRef = useRef(paused)
  pausedRef.current = paused

  const base = opts?.store?.getBaseUrl() ?? ""
  const headersRef = useRef(opts?.store?.authHeaders() ?? {})
  headersRef.current = opts?.store?.authHeaders() ?? {}
  const logsEndpoint = opts?.logsEndpoint ?? "/api/logs"

  const addEntry = useCallback((entry: LogEntry) => {
    if (seenIds.current.has(entry.id)) return
    seenIds.current.add(entry.id)

    setEntries(prev => {
      const next = [...prev, entry]
      if (next.length > maxEntries) {
        const removed = next.splice(0, next.length - maxEntries)
        for (const r of removed) seenIds.current.delete(r.id)
      }
      return next
    })
  }, [maxEntries])

  const refresh = useCallback(async (filter?: LogFilter) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (filter?.level) params.set("level", filter.level)
      if (filter?.category) params.set("category", filter.category)
      if (filter?.source) params.set("source", filter.source)
      if (filter?.search) params.set("search", filter.search)
      if (filter?.job_id) params.set("job_id", filter.job_id)
      if (filter?.correlation_id) params.set("correlation_id", filter.correlation_id)
      if (filter?.limit) params.set("limit", String(filter.limit))

      const qs = params.toString()
      const url = `${base}${logsEndpoint}${qs ? `?${qs}` : ""}`
      const res = await fetch(url, { headers: headersRef.current })

      if (!res.ok) {
        setError(`Failed to fetch logs (${res.status})`)
        return
      }

      const data: LogsResponse = await res.json()
      if (!activeRef.current) return

      seenIds.current.clear()
      for (const entry of data.entries) seenIds.current.add(entry.id)
      setEntries(data.entries)
    } catch (e) {
      if (activeRef.current) {
        setError(e instanceof Error ? e.message : "Failed to fetch logs")
      }
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [base, logsEndpoint])

  const wsUrl = useCallback(() => {
    const wsBase = base.replace(/^http/, "ws")
    const wsPath = opts?.wsEndpoint ?? "/ws"
    return `${wsBase}${wsPath}`
  }, [base, opts?.wsEndpoint])

  useEffect(() => {
    activeRef.current = true
    refresh()

    if (!autoConnect) return

    const handle = createWebSocket({
      url: wsUrl,
      onEvent: (event) => {
        if (pausedRef.current || !activeRef.current) return
        if (event.type === "log.entry" && event.data) {
          addEntry(event.data as LogEntry)
        }
      },
      onConnect: () => {
        if (activeRef.current) setConnected(true)
      },
      onDisconnect: () => {
        if (activeRef.current) setConnected(false)
      },
    })

    return () => {
      activeRef.current = false
      handle.close()
    }
  }, [refresh, wsUrl, autoConnect, addEntry])

  const clear = useCallback(async () => {
    try {
      await fetch(`${base}${logsEndpoint}/clear`, {
        method: "POST",
        headers: headersRef.current,
      })
      seenIds.current.clear()
      setEntries([])
    } catch {
      // best effort
    }
  }, [base, logsEndpoint])

  const errorCount = entries.filter(
    e => e.level === "error" || e.level === "critical",
  ).length

  const warnCount = entries.filter(e => e.level === "warn").length

  return {
    entries,
    connected,
    paused,
    setPaused,
    errorCount,
    warnCount,
    loading,
    error,
    clear,
    refresh,
  }
}
