import { createContext, useContext, useState, useEffect, useCallback, useRef } from "react"
import type { RemoteConnectionStore } from "./remote-connection"

export interface RemoteAccessStatus {
  enabled: boolean
  tunnel_status: string
  is_external: boolean
  hostname: string | null
  auth_enabled: boolean
  error: string | null
}

export interface RemoteAccessContextValue {
  status: RemoteAccessStatus | null
  loading: boolean
  enable: () => Promise<void>
  disable: () => Promise<void>
  regenerateToken: () => Promise<string>
}

const RemoteAccessContext = createContext<RemoteAccessContextValue | null>(null)

export function RemoteAccessProvider({
  store,
  pollIntervalMs = 10000,
  children,
}: {
  store: RemoteConnectionStore
  pollIntervalMs?: number
  children: React.ReactNode
}) {
  const [status, setStatus] = useState<RemoteAccessStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const activeRef = useRef(true)

  const fetchStatus = useCallback(async () => {
    const base = store.getBaseUrl()
    try {
      const res = await fetch(`${base}/api/remote/status`, {
        headers: store.authHeaders(),
      })
      if (res.ok && activeRef.current) {
        setStatus(await res.json())
      }
    } catch {
      // server unreachable
    } finally {
      if (activeRef.current) setLoading(false)
    }
  }, [store])

  useEffect(() => {
    activeRef.current = true
    fetchStatus()
    const id = setInterval(fetchStatus, pollIntervalMs)
    return () => {
      activeRef.current = false
      clearInterval(id)
    }
  }, [fetchStatus, pollIntervalMs])

  const enable = useCallback(async () => {
    const base = store.getBaseUrl()
    await fetch(`${base}/api/remote/enable`, {
      method: "POST",
      headers: store.authHeaders(),
    })
    await fetchStatus()
  }, [store, fetchStatus])

  const disable = useCallback(async () => {
    const base = store.getBaseUrl()
    await fetch(`${base}/api/remote/disable`, {
      method: "POST",
      headers: store.authHeaders(),
    })
    await fetchStatus()
  }, [store, fetchStatus])

  const regenerateToken = useCallback(async () => {
    const base = store.getBaseUrl()
    const res = await fetch(`${base}/api/remote/token`, {
      method: "PUT",
      headers: store.authHeaders(),
    })
    const data = await res.json() as { access_token: string }
    await fetchStatus()
    return data.access_token
  }, [store, fetchStatus])

  return (
    <RemoteAccessContext.Provider value={{ status, loading, enable, disable, regenerateToken }}>
      {children}
    </RemoteAccessContext.Provider>
  )
}

export function useRemoteAccess(): RemoteAccessContextValue {
  const ctx = useContext(RemoteAccessContext)
  if (!ctx) throw new Error("useRemoteAccess must be used within RemoteAccessProvider")
  return ctx
}
