/** The close code the server sends to a device whose session ended. The socket is not reopened. */
export const SESSION_REVOKED_CLOSE_CODE = 4401

/**
 * The longest wait between reconnect attempts that keep failing (signed out, server down). The same as the
 * /ws upstream relay's own maximum (AppHost WebSocketEndpoints, maxRetrySeconds), so a browser is never
 * slower to come back than the relay behind it.
 */
export const MAX_RECONNECT_MS = 15_000

/**
 * The wait before reconnect attempt number `failures` (1 for the first) since the socket was last open:
 * `baseMs`, then doubling up to {@link MAX_RECONNECT_MS}. A socket that opens resets the count.
 */
export function reconnectDelay(baseMs: number, failures: number): number {
  const doublings = Math.min(Math.max(failures - 1, 0), 16)
  return Math.min(baseMs * 2 ** doublings, Math.max(baseMs, MAX_RECONNECT_MS))
}

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
  /**
   * Awaited before every reconnect (not the first connect). Used to renew an expired
   * session badge so the upgrade is not rejected. May return undefined to reconnect now.
   * `previousAttemptOpened` is false when the last socket closed without ever opening (the
   * server refused the upgrade, or was unreachable).
   */
  beforeReconnect?: (context: { previousAttemptOpened: boolean }) => Promise<unknown> | undefined | void
  /**
   * The server closed the socket with {@link SESSION_REVOKED_CLOSE_CODE}: this device was signed out.
   * The handle stops reconnecting, including on resume, until {@link WebSocketHandle.rearm}.
   */
  onSessionRevoked?: (reason: string) => void
}

export interface WebSocketHandle {
  close: () => void
  /**
   * Someone signed in again without a reload: a handle a 4401 close stopped connects again. Does
   * nothing on a handle that was not stopped that way, or that was closed.
   */
  rearm: () => void
}

export function createWebSocket(opts: CreateWebSocketOptions): WebSocketHandle {
  const reconnectMs = opts.reconnectMs ?? 3000
  let ws: WebSocket | null = null
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
  let closed = false
  let revoked = false
  let hasConnected = false
  let lastResumeReconnectAt = 0
  let reconnectEpoch = 0
  // Closes since the socket was last open: a socket the server keeps refusing (signed out, or down)
  // is retried less and less often instead of every few seconds.
  let failures = 0
  // Whether the socket created last opened before it closed.
  let lastAttemptOpened = true

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
    if (closed || revoked) return
    cleanup()
    const url = typeof opts.url === "function" ? opts.url() : opts.url
    ws = new WebSocket(url)
    lastAttemptOpened = false

    ws.onopen = () => {
      lastAttemptOpened = true
      failures = 0
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

    ws.onclose = (event?: CloseEvent) => {
      opts.onDisconnect?.()
      if (event?.code === SESSION_REVOKED_CLOSE_CODE) {
        revoked = true
        opts.onSessionRevoked?.(event.reason)
        return
      }
      if (!closed) {
        failures++
        reconnectTimeout = setTimeout(reconnect, reconnectDelay(reconnectMs, failures))
      }
    }

    ws.onerror = () => {
      ws?.close()
    }
  }

  function reconnect() {
    if (closed || revoked) return
    const epoch = ++reconnectEpoch
    let pending: Promise<unknown> | undefined | void
    try {
      pending = opts.beforeReconnect?.({ previousAttemptOpened: lastAttemptOpened })
    } catch {
      pending = undefined
    }
    if (!pending || typeof (pending as Promise<unknown>).then !== "function") {
      connect()
      return
    }
    const go = () => {
      if (epoch === reconnectEpoch) connect()
    }
    ;(pending as Promise<unknown>).then(go, go)
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
    reconnect()
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
    rearm() {
      if (closed || !revoked) return
      revoked = false
      failures = 0
      connect()
    },
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
