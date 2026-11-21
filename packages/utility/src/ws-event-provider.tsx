import { useCallback, useEffect, useMemo, useRef } from "react"
import { createWebSocket } from "./create-websocket"
import { ensureFreshSession, reportSessionRevoked, SIGNED_IN_EVENT } from "./session-renewal"
import type { WsEvent } from "./create-websocket"
import { WsEventContext } from "./ws-events"
import type { WsEventContextValue } from "./ws-events"

export interface WsEventProviderProps {
  url: string | (() => string)
  onReconnect?: () => void
  onVisibilityChange?: () => void
  reconnectMs?: number
  children: React.ReactNode
}

export function WsEventProvider({
  url,
  onReconnect,
  onVisibilityChange,
  reconnectMs,
  children,
}: WsEventProviderProps) {
  const handlersRef = useRef(new Set<(event: WsEvent) => void>())

  const subscribe = useCallback((handler: (event: WsEvent) => void) => {
    handlersRef.current.add(handler)
    return () => {
      handlersRef.current.delete(handler)
    }
  }, [])

  const dispatch = useCallback((event: WsEvent) => {
    for (const handler of handlersRef.current) handler(event)
  }, [])

  useEffect(() => {
    const emit = (event: WsEvent) => {
      for (const handler of handlersRef.current) handler(event)
    }
    const handle = createWebSocket({
      url,
      onEvent: emit,
      onConnect: () => emit({ type: "websocket.connected", data: null }),
      onDisconnect: () => emit({ type: "websocket.disconnected", data: null }),
      onReconnect,
      onVisibilityChange,
      reconnectMs,
      beforeReconnect: ensureFreshSession,
      onSessionRevoked: reportSessionRevoked,
    })
    // Signed in again without a reload: a socket a 4401 close stopped connects again.
    const rearm = () => handle.rearm()
    window.addEventListener(SIGNED_IN_EVENT, rearm)
    return () => {
      window.removeEventListener(SIGNED_IN_EVENT, rearm)
      handle.close()
    }
  }, [url, onReconnect, onVisibilityChange, reconnectMs])

  const value = useMemo<WsEventContextValue>(
    () => ({ subscribe, dispatch }),
    [subscribe, dispatch],
  )

  return <WsEventContext value={value}>{children}</WsEventContext>
}
