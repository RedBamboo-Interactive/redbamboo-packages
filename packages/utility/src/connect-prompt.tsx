import { useState, useCallback } from "react"
import { Button, Card, CardContent, Input, Label } from "@redbamboo/ui"
import { AppHeaderBrand } from "./app-header"
import type { RemoteConnectionStore } from "./remote-connection"

export interface ConnectPromptProps {
  brand: {
    icon: string
    name: string
    nameParts?: [string, string]
    accentClass?: string
  }
  store: RemoteConnectionStore
  validateEndpoint?: string
  showServerUrl?: boolean
  defaultServerUrl?: string
  onConnected: () => void
}

export function ConnectPrompt({
  brand,
  store,
  validateEndpoint = "/ping",
  showServerUrl = false,
  defaultServerUrl = "",
  onConnected,
}: ConnectPromptProps) {
  const [serverUrl, setServerUrl] = useState(defaultServerUrl)
  const [token, setToken] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleSubmit = useCallback(async () => {
    setLoading(true)
    setError(null)

    const base = showServerUrl ? serverUrl.replace(/\/+$/, "") : ""
    const url = `${base}${validateEndpoint}`
    const headers: Record<string, string> = {}
    if (token) headers["Authorization"] = `Bearer ${token}`

    try {
      const res = await fetch(url, { headers })
      if (!res.ok) {
        setError(res.status === 401 ? "Invalid access token" : `Connection failed (${res.status})`)
        setLoading(false)
        return
      }
      store.set({ serverUrl: base, token })
      onConnected()
    } catch {
      setError("Could not connect to server")
    } finally {
      setLoading(false)
    }
  }, [serverUrl, token, showServerUrl, validateEndpoint, store, onConnected])

  return (
    <div className="flex items-center justify-center min-h-screen p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="pt-6 space-y-6">
          <div className="flex justify-center">
            <AppHeaderBrand
              icon={brand.icon}
              nameParts={brand.nameParts ?? [brand.name, ""]}
              accentClass={brand.accentClass}
            />
          </div>

          <div className="space-y-4">
            {showServerUrl && (
              <div className="space-y-2">
                <Label>Server URL</Label>
                <Input
                  value={serverUrl}
                  onChange={e => setServerUrl((e.target as HTMLInputElement).value)}
                  placeholder="http://localhost:18800"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>Access Token</Label>
              <Input
                type="password"
                value={token}
                onChange={e => setToken((e.target as HTMLInputElement).value)}
                placeholder="Paste your access token"
                onKeyDown={e => { if (e.key === "Enter") handleSubmit() }}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive">{error}</p>
            )}

            <Button
              className="w-full"
              onClick={handleSubmit}
              disabled={loading || (!token && store.isRemoteAccess())}
            >
              {loading ? "Connecting..." : "Connect"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
