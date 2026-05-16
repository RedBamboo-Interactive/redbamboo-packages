import { useCallback, useEffect, useMemo, useRef } from "react"
import { createWebSocket } from "./create-websocket"
import type { WsEvent } from "./create-websocket"
import { WsEventContext } from "./ws-events"
import type { WsEventContextValue } from "./ws-events"

export interface WsEventProviderProps {
  url: string | (() => string)
  onReconnect?: () => void
  reconnectMs?: number
  children: React.ReactNode
}

export function WsEventProvider({
  url,
  onReconnect,
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
    const handle = createWebSocket({
      url,
      onEvent: (event) => {
        for (const handler of handlersRef.current) handler(event)
      },
      onReconnect,
      reconnectMs,
    })
    return () => handle.close()
  }, [url, onReconnect, reconnectMs])

  const value = useMemo<WsEventContextValue>(
    () => ({ subscribe, dispatch }),
    [subscribe, dispatch],
  )

  return <WsEventContext value={value}>{children}</WsEventContext>
}
