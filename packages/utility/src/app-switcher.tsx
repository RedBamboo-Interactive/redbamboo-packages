import { useState, useEffect, useMemo } from "react"
import { cn, Dialog, DialogContent } from "@redbamboo/ui"
import "./app-switcher.css"

interface AppEntry {
  port: number
  icon: string
  nameParts: [string, string]
  color: string
  description: string
}

const APP_REGISTRY: AppEntry[] = [
  { port: 18800, icon: "fa-solid fa-microchip", nameParts: ["Red", "Compute"], color: "#26A69A", description: "AI compute service" },
  { port: 18801, icon: "fa-solid fa-terminal", nameParts: ["Code", "Red"], color: "#E55B5B", description: "Development tools" },
  { port: 18802, icon: "fa-solid fa-fire", nameParts: ["Red", "Matter"], color: "#D4A03C", description: "Game engine CMS" },
  { port: 18803, icon: "fa-solid fa-star", nameParts: ["No", "va"], color: "#C74B7A", description: "AI assistant" },
  { port: 18804, icon: "fa-solid fa-leaf", nameParts: ["Red", "Leaf"], color: "#66BB6A", description: "Content & knowledge" },
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
      <DialogContent showCloseButton={false} className="w-72 sm:max-w-none p-2">
        <div className="app-switcher-list">
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
                  "app-switcher-row",
                  entered && "app-switcher-row--entered",
                  isOffline && "app-switcher-row--offline",
                  isActive && "app-switcher-row--active",
                )}
                style={
                  {
                    "--tile-i": i,
                    "--app-color": app.color,
                  } as React.CSSProperties
                }
              >
                <div className="app-switcher-row__icon">
                  <div className="app-switcher-row__icon-bg" />
                  <i className={cn(app.icon, "app-switcher-row__icon-i")} />
                </div>
                <div className="app-switcher-row__text">
                  <span className="app-switcher-row__name">
                    {allLetters.map((char, j) => (
                      <span
                        key={j}
                        className="app-switcher-row__letter inline-block"
                        style={{
                          "--letter-i": j,
                          color: j < mutedCount ? undefined : app.color,
                        } as React.CSSProperties}
                      >
                        {char}
                      </span>
                    ))}
                  </span>
                  <span className="app-switcher-row__desc">{app.description}</span>
                </div>
              </a>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { AppSwitcher }
