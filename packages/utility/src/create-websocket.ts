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

  function connect() {
    if (closed) return
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

  connect()

  return {
    close() {
      closed = true
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      ws?.close()
    },
  }
}
