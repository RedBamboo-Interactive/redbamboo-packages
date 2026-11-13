import { useEffect, useRef, useState } from "react"
import { useWsSubscribe } from "@redbamboo/utility"
import { useUiEnvironment } from "@redbamboo/ui"
import { MaintenanceStatusReader, type MaintenanceStatusLoader, type MaintenanceStatusSnapshot } from "../lib/maintenance-status-reader"

export interface UseMaintenanceStatusOptions {
  /** Reads the host's maintenance route (Nova proxies it; Code reads RedCompute's). */
  load: MaintenanceStatusLoader
  /** A window event that asks for a fresh read, e.g. "nova:maintenance-refresh". */
  refreshEvent?: string
}

/**
 * The maintenance status for ChatPanel's `maintenanceStatus` / `maintenanceStatusUnavailable`.
 * Re-reads on mount, on reconnect, when the window comes back to the foreground and on the
 * host's refresh event; a disconnect marks the last status unavailable.
 */
export function useMaintenanceStatus({ load, refreshEvent }: UseMaintenanceStatusOptions): MaintenanceStatusSnapshot {
  const environment = useUiEnvironment()
  const [snapshot, setSnapshot] = useState<MaintenanceStatusSnapshot>({ status: null, unavailable: false })
  const loadRef = useRef(load)
  loadRef.current = load
  const readerRef = useRef<MaintenanceStatusReader | null>(null)
  readerRef.current ??= new MaintenanceStatusReader(() => loadRef.current(), setSnapshot)

  useWsSubscribe(event => {
    const reader = readerRef.current
    if (!reader) return
    if (event.type === "upstream.connected" || event.type === "websocket.connected") reader.refresh()
    if (event.type === "upstream.disconnected" || event.type === "websocket.disconnected") reader.disconnected()
  })
  useEffect(() => {
    const reader = readerRef.current!
    reader.start()
    const refresh = () => { reader.refresh() }
    const foreground = () => { if (environment.document.visibilityState !== "hidden") reader.refresh() }
    environment.window.addEventListener("focus", foreground)
    environment.document.addEventListener("visibilitychange", foreground)
    if (refreshEvent) environment.window.addEventListener(refreshEvent, refresh)
    return () => {
      reader.stop()
      environment.window.removeEventListener("focus", foreground)
      environment.document.removeEventListener("visibilitychange", foreground)
      if (refreshEvent) environment.window.removeEventListener(refreshEvent, refresh)
    }
  }, [environment.window, environment.document, refreshEvent])
  return snapshot
}
