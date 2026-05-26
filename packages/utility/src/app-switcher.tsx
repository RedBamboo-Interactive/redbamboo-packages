import { useState, useEffect, useMemo } from "react"
import { cn, Dialog, DialogContent } from "@redbamboo/ui"
import "./app-switcher.css"

interface AppEntry {
  port: number
  icon: string
  nameParts: [string, string]
  color: string
}

const APP_REGISTRY: AppEntry[] = [
  { port: 18800, icon: "fa-solid fa-microchip", nameParts: ["Red", "Compute"], color: "#26A69A" },
  { port: 18801, icon: "fa-solid fa-terminal", nameParts: ["Code", "Red"], color: "#E55B5B" },
  { port: 18802, icon: "fa-solid fa-fire", nameParts: ["Red", "Matter"], color: "#D4A03C" },
  { port: 18803, icon: "fa-solid fa-star", nameParts: ["No", "va"], color: "#C74B7A" },
]

function useAppDiscovery(open: boolean) {
  const [statuses, setStatuses] = useState<Record<number, boolean>>({})

  useEffect(() => {
    if (!open) return

    setStatuses({})
    const controllers: AbortController[] = []
    const hostname = window.location.hostname || "localhost"
    const protocol = window.location.protocol

    for (const app of APP_REGISTRY) {
      const controller = new AbortController()
      controllers.push(controller)

      fetch(`${protocol}//${hostname}:${app.port}/discover`, {
        signal: controller.signal,
      })
        .then((r) => setStatuses((prev) => ({ ...prev, [app.port]: r.ok })))
        .catch(() => setStatuses((prev) => ({ ...prev, [app.port]: false })))
    }

    return () => controllers.forEach((c) => c.abort())
  }, [open])

  return statuses
}

export interface AppSwitcherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function AppSwitcher({ open, onOpenChange }: AppSwitcherProps) {
  const statuses = useAppDiscovery(open)
  const currentPort = typeof window !== "undefined" ? window.location.port : ""
  const [entered, setEntered] = useState(false)

  useEffect(() => {
    if (!open) {
      setEntered(false)
      return
    }
    const timer = setTimeout(() => setEntered(true), 800)
    return () => clearTimeout(timer)
  }, [open])

  const baseUrl = useMemo(() => {
    if (typeof window === "undefined") return ""
    const hostname = window.location.hostname || "localhost"
    return `${window.location.protocol}//${hostname}`
  }, [])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="w-fit sm:max-w-none p-4">
        <div className="app-switcher-grid">
          {APP_REGISTRY.map((app, i) => {
            const isOffline = statuses[app.port] === false
            const allLetters = (app.nameParts[0] + app.nameParts[1]).split("")
            const mutedCount = app.nameParts[0].length
            const isActive = String(app.port) === currentPort

            return (
              <a
                key={app.port}
                href={`${baseUrl}:${app.port}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.preventDefault()
                  if (isOffline) return
                  if (!isActive) {
                    window.open(`${baseUrl}:${app.port}`, "_blank", "noopener,noreferrer")
                  }
                  onOpenChange(false)
                }}
                className={cn(
                  "app-switcher-tile",
                  entered && "app-switcher-tile--entered",
                  isOffline && "app-switcher-tile--offline",
                )}
                style={
                  {
                    "--tile-i": i,
                    color: app.color,
                  } as React.CSSProperties
                }
              >
                <div className="app-switcher-tile__icon">
                  <div className="app-switcher-tile__icon-bg" />
                  <i className={cn(app.icon, "app-switcher-tile__icon-i")} />
                </div>
                <span className="text-sm font-semibold">
                  {allLetters.map((char, j) => (
                    <span
                      key={j}
                      className={cn(
                        "app-switcher-tile__letter inline-block",
                        j < mutedCount ? "text-muted-foreground" : "text-current",
                      )}
                      style={{ "--letter-i": j } as React.CSSProperties}
                    >
                      {char}
                    </span>
                  ))}
                </span>
              </a>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { AppSwitcher }
