import { useState, useEffect, useCallback } from "react"
import type { RemoteConnectionStore } from "./remote-connection"

export interface ParameterInfo {
  name: string
  type: string
  required?: boolean
  description?: string
  default?: unknown
  enum?: string[]
  /** "query" | "body" | "path" | "header" — absent means inferred from the HTTP verb. */
  location?: string
}

export interface EndpointInfo {
  method: string
  path: string
  description: string
  parameters?: ParameterInfo[] | null
  /** JSON-schema-shaped request body, when the flat parameter model can't express it. */
  requestBody?: unknown
  /** JSON-schema-shaped success response body. */
  response?: unknown
  /** Auth requirement annotation: "none" | "local" | "bearer" | "jwt". */
  auth?: string | null
}

export interface CapabilityInfo {
  slug: string
  displayName: string
  status: string
  description?: string
  endpoints?: EndpointInfo[]
}

export interface ProxyInfo {
  prefix: string
  upstream: string
  /** The upstream's /discover URL — follow it for the surface behind this prefix. */
  discover: string
  description?: string
}

export interface ServiceManifest {
  service: string
  name?: string
  version: string
  description: string
  api_base: string
  iconClass?: string | null
  iconColor?: string | null
  capabilities: CapabilityInfo[]
  app_endpoints: EndpointInfo[]
  proxies?: ProxyInfo[] | null
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
      token?: string
    }
    logs?: {
      list: string
      summary: string
      clear: string
    }
    telemetry?: {
      list: string
      stats: string
      process: string
      cleanup: string
    }
    autostart?: string
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
