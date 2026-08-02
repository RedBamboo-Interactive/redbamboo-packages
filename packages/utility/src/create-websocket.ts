export interface WsEvent {
  type: string
  data: unknown
}

export interface CreateWebSocketOptions {
  url: string | (() => string)
  onEvent: (event: WsEvent) => void
  onConnect?: () => void
  onDisconnect?: () => void
  onReconnect?: () => void
  onVisibilityChange?: () => void
  reconnectMs?: number
}

export interface WebSocketHandle {
  close: () => void
}

export function createWebSocket(opts: CreateWebSocketOptions): WebSocketHandle {
  const reconnectMs = opts.reconnectMs ?? 3000
  let ws: WebSocket | null = null
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let hasConnected = false
  let lastResumeReconnectAt = 0

  function cleanup() {
    if (ws) {
      ws.onopen = null
      ws.onclose = null
      ws.onerror = null
      ws.onmessage = null
      ws.close()
      ws = null
    }
    if (reconnectTimeout) {
      clearTimeout(reconnectTimeout)
      reconnectTimeout = null
    }
  }

  function connect() {
    if (closed) return
    cleanup()
    const url = typeof opts.url === "function" ? opts.url() : opts.url
    ws = new WebSocket(url)

    ws.onopen = () => {
      if (hasConnected && opts.onReconnect) opts.onReconnect()
      hasConnected = true
      opts.onConnect?.()
    }

    ws.onmessage = (e) => {
      try {
        const event = JSON.parse(e.data) as WsEvent
        opts.onEvent(event)
      } catch {
        /* ignore malformed messages */
      }
    }

    ws.onclose = () => {
      opts.onDisconnect?.()
      if (!closed) {
        reconnectTimeout = setTimeout(connect, reconnectMs)
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  function handleVisibilityChange() {
    if (closed || document.visibilityState !== "visible") return
    opts.onVisibilityChange?.()
    reconnectAfterResume()
  }

  function reconnectAfterResume() {
    if (closed || (typeof document !== "undefined" && document.visibilityState !== "visible")) return

    // Mobile browsers can freeze a background tab without closing its TCP socket.
    // readyState then remains OPEN forever even though no frames are delivered. A
    // visibility/pageshow/online signal is authoritative evidence that the client
    // crossed a lifecycle boundary, so replace the socket regardless of readyState.
    // Debounce because Android commonly emits pageshow and visibilitychange together.
    const now = Date.now()
    if (now - lastResumeReconnectAt < 250) return
    lastResumeReconnectAt = now
    connect()
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange)
  }
  if (typeof window !== "undefined") {
    window.addEventListener("pageshow", reconnectAfterResume)
    window.addEventListener("online", reconnectAfterResume)
  }

  connect()

  return {
    close() {
      closed = true
      cleanup()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange)
      }
      if (typeof window !== "undefined") {
        window.removeEventListener("pageshow", reconnectAfterResume)
        window.removeEventListener("online", reconnectAfterResume)
      }
    },
  }
}
