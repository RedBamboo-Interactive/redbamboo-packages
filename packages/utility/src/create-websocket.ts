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
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      connect()
    }
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange)
  }

  connect()

  return {
    close() {
      closed = true
      cleanup()
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange)
      }
    },
  }
}
