import { useState, useEffect, useCallback } from "react"
import { ProtectedValueField, Switch, type ProtectedValueStatus } from "@redbamboo/ui"
import type { RemoteConnectionStore } from "./remote-connection"

export interface TunnelStatus {
  enabled: boolean
  tunnel_status: string
  is_external: boolean
  hostname: string | null
  auth_enabled: boolean
  tunnel_token?: ProtectedValueStatus
  error: string | null
}

export interface TunnelSettingsPanelProps {
  store?: RemoteConnectionStore
  pollIntervalMs?: number
}

const statusColor: Record<string, string> = {
  stopped: "#727680",
  starting: "#FFB74D",
  running: "#43A25A",
  error: "#FF5252",
}

export function TunnelSettingsPanel({
  store,
  pollIntervalMs = 5000,
}: TunnelSettingsPanelProps) {
  const [status, setStatus] = useState<TunnelStatus | null>(null)
  const [loading, setLoading] = useState(false)

  const base = store?.getBaseUrl() ?? ""
  const headers = store?.authHeaders() ?? {}

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${base}/api/remote/status`, { headers })
      if (res.ok) setStatus(await res.json())
    } catch { /* server unreachable */ }
  }, [base])

  useEffect(() => {
    fetchStatus()
    const id = setInterval(fetchStatus, pollIntervalMs)
    return () => clearInterval(id)
  }, [fetchStatus, pollIntervalMs])

  const toggle = useCallback(async () => {
    if (!status) return
    setLoading(true)
    const endpoint = status.enabled ? "/api/remote/disable" : "/api/remote/enable"
    try {
      await fetch(`${base}${endpoint}`, { method: "POST", headers })
      await fetchStatus()
    } catch { /* ignore */ }
    setLoading(false)
  }, [status, base, fetchStatus])

  const regenerateToken = useCallback(async () => {
    setLoading(true)
    try {
      await fetch(`${base}/api/remote/token`, { method: "PUT", headers })
      await fetchStatus()
    } catch { /* ignore */ }
    setLoading(false)
  }, [base, fetchStatus])

  const replaceTunnelToken = useCallback(async (value: string) => {
    const response = await fetch(`${base}/api/remote/secrets/tunnel-token`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({ value }),
    })
    if (!response.ok) {
      const payload = await response.json().catch(() => null) as { error?: string } | null
      throw new Error(payload?.error ?? "Could not save the tunnel token")
    }
    await fetchStatus()
  }, [base, fetchStatus])

  const clearTunnelToken = useCallback(async () => {
    const response = await fetch(`${base}/api/remote/secrets/tunnel-token`, {
      method: "DELETE",
      headers,
    })
    if (!response.ok) throw new Error("Could not clear the tunnel token")
    await fetchStatus()
  }, [base, fetchStatus])

  if (!status) {
    return (
      <div data-slot="tunnel-settings-panel" className="space-y-2">
        <p className="text-xs text-text-muted">Loading tunnel status...</p>
      </div>
    )
  }

  const color = statusColor[status.tunnel_status] ?? statusColor.stopped

  return (
    <div data-slot="tunnel-settings-panel" className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ backgroundColor: color }}
          />
          <span className="text-sm capitalize">{status.tunnel_status}</span>
          {status.is_external && (
            <span className="text-xs text-text-muted">(external)</span>
          )}
        </div>
        <Switch
          checked={status.enabled}
          onCheckedChange={toggle}
          disabled={loading}
        />
      </div>

      {status.error && (
        <p className="text-xs text-destructive">{status.error}</p>
      )}

      <ProtectedValueField
        id="remote-tunnel-token"
        label="Tunnel token"
        kind="token"
        status={status.tunnel_token ?? {
          configured: false,
          protection: "unknown",
          verification: "unverified",
        }}
        placeholder="Paste the Cloudflare tunnel token"
        description="Encrypted on this machine. Replacing it takes effect the next time the tunnel starts. Clearing it stops the tunnel."
        disabled={loading}
        onReplace={replaceTunnelToken}
        onClear={clearTunnelToken}
      />

      {status.tunnel_status === "running" && status.hostname && (
        <div className="flex items-center justify-between">
          <span className="text-xs text-text-muted">Hostname</span>
          <button
            className="text-xs font-mono text-text-muted hover:text-foreground transition-colors"
            onClick={() => navigator.clipboard.writeText(`https://${status.hostname}`)}
            title="Copy URL"
          >
            https://{status.hostname}
          </button>
        </div>
      )}

      {status.auth_enabled && (
        <ProtectedValueField
          id="remote-access-token"
          label="Access token"
          kind="token"
          status={{
            configured: true,
            protection: "encrypted",
            verification: "unverified",
          }}
          description="Generated locally and encrypted on this machine. Rotating it invalidates existing remote connections."
          disabled={loading}
          replaceable={false}
          allowClear={false}
          onRotate={regenerateToken}
        />
      )}
    </div>
  )
}
