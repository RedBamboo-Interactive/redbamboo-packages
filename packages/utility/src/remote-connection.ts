export interface ConnectionConfig {
  serverUrl: string
  token: string
}

export interface RemoteConnectionStore {
  get(): ConnectionConfig | null
  set(config: { serverUrl?: string; token: string }): void
  clear(): void
  getBaseUrl(): string
  isRemoteAccess(): boolean
  authHeaders(): Record<string, string>
  authUrl(path: string): string
}

export function createRemoteConnection(opts: {
  storageKey: string
  cookieName: string
  defaultServerUrl?: string
}): RemoteConnectionStore {
  function get(): ConnectionConfig | null {
    const raw = localStorage.getItem(opts.storageKey)
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as Partial<ConnectionConfig>
      if (parsed.token == null) return null
      return { serverUrl: parsed.serverUrl ?? opts.defaultServerUrl ?? "", token: parsed.token }
    } catch {
      return null
    }
  }

  function set(config: { serverUrl?: string; token: string }) {
    const full: ConnectionConfig = {
      serverUrl: config.serverUrl ?? opts.defaultServerUrl ?? "",
      token: config.token,
    }
    localStorage.setItem(opts.storageKey, JSON.stringify(full))
    document.cookie = `${opts.cookieName}=${encodeURIComponent(config.token)}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Strict; Secure`
  }

  function clear() {
    localStorage.removeItem(opts.storageKey)
    document.cookie = `${opts.cookieName}=; path=/; max-age=0`
  }

  function getBaseUrl(): string {
    return get()?.serverUrl ?? ""
  }

  function isRemoteAccess(): boolean {
    const host = window.location.hostname
    return host !== "localhost" && host !== "127.0.0.1" && host !== "::1"
  }

  function authHeaders(): Record<string, string> {
    const config = get()
    if (!config?.token || !isRemoteAccess()) return {}
    return { Authorization: `Bearer ${config.token}` }
  }

  function authUrl(path: string): string {
    const config = get()
    if (!config?.token || !isRemoteAccess()) return path
    const base = getBaseUrl()
    const full = base ? `${base}${path}` : path
    const sep = full.includes("?") ? "&" : "?"
    return `${full}${sep}token=${encodeURIComponent(config.token)}`
  }

  return { get, set, clear, getBaseUrl, isRemoteAccess, authHeaders, authUrl }
}

export function applyConnectionParams(store: RemoteConnectionStore): void {
  const params = new URLSearchParams(window.location.search)
  const token = params.get("token")
  if (token) {
    const serverUrl = params.get("server") ?? undefined
    store.set({ serverUrl, token })

    params.delete("token")
    params.delete("server")
    const search = params.toString()
    const newUrl = window.location.pathname + (search ? `?${search}` : "") + window.location.hash
    window.history.replaceState(null, "", newUrl)
  }

  // Clear stale serverUrl that points to a different localhost port.
  // Requests should go through same-origin so backend proxies can
  // inject headers like X-Caller-Info.
  const conn = store.get()
  if (conn && conn.serverUrl) {
    try {
      const stored = new URL(conn.serverUrl)
      const isSameOrigin = stored.origin === window.location.origin
      if (!isSameOrigin && (store.isRemoteAccess() || stored.hostname === "localhost")) {
        store.set({ token: conn.token })
      }
    } catch { /* invalid URL, leave as-is */ }
  }
}

export async function autoConnect(
  store: RemoteConnectionStore,
  endpoint = "/ping",
): Promise<boolean> {
  const conn = store.get()
  if (conn) return true
  try {
    const res = await fetch(endpoint)
    if (res.ok) {
      store.set({ token: "" })
      return true
    }
  } catch { /* server not reachable */ }
  return false
}
