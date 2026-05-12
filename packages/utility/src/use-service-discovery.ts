import { useState, useEffect, useCallback } from "react"
import type { RemoteConnectionStore } from "./remote-connection"

export interface EndpointInfo {
  method: string
  path: string
  description: string
}

export interface CapabilityInfo {
  slug: string
  displayName: string
  status: string
  description?: string
  endpoints?: EndpointInfo[]
}

export interface ServiceManifest {
  service: string
  version: string
  description: string
  api_base: string
  capabilities: CapabilityInfo[]
  app_endpoints: EndpointInfo[]
  management: {
    ping: string
    health: string
    discovery: string
    openapi: string
    remote?: {
      status: string
      enable: string
      disable: string
      share: string
    }
  }
}

export function useServiceDiscovery(opts?: {
  store?: RemoteConnectionStore
  discoverEndpoint?: string
}): {
  manifest: ServiceManifest | null
  loading: boolean
  error: string | null
  refresh: () => Promise<void>
} {
  const [manifest, setManifest] = useState<ServiceManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    const base = opts?.store?.getBaseUrl() ?? ""
    const endpoint = opts?.discoverEndpoint ?? "/discover"
    try {
      const headers = opts?.store?.authHeaders() ?? {}
      const res = await fetch(`${base}${endpoint}`, { headers })
      if (!res.ok) {
        setError(`Discovery failed (${res.status})`)
        return
      }
      setManifest(await res.json())
    } catch (e) {
      setError(e instanceof Error ? e.message : "Discovery failed")
    } finally {
      setLoading(false)
    }
  }, [opts?.store, opts?.discoverEndpoint])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { manifest, loading, error, refresh }
}
