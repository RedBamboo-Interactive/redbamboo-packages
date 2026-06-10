import { useState, useEffect, useMemo } from "react"
import { cn, Dialog, DialogContent } from "@redbamboo/ui"
import { SUITE_APPS } from "./suite-registry"
import "./app-switcher.css"

interface DiscoveredApp {
  ok: boolean
  /** Live manifest values override the static registry when the app is reachable. */
  description?: string
  icon?: string
  color?: string
}

function useAppDiscovery(open: boolean) {
  const [statuses, setStatuses] = useState<Record<number, DiscoveredApp>>({})

  useEffect(() => {
    if (!open) return

    setStatuses({})
    const controllers: AbortController[] = []
    const hostname = window.location.hostname || "localhost"
    const protocol = window.location.protocol

    for (const app of SUITE_APPS) {
      const controller = new AbortController()
      controllers.push(controller)

      fetch(`${protocol}//${hostname}:${app.port}/discover`, {
        signal: controller.signal,
      })
        .then(async (r) => {
          let info: DiscoveredApp = { ok: r.ok }
          if (r.ok) {
            try {
              const manifest = await r.json()
              info = {
                ok: true,
                description: typeof manifest.description === "string" ? manifest.description : undefined,
                icon: typeof manifest.iconClass === "string" ? manifest.iconClass : undefined,
                color: typeof manifest.iconColor === "string" ? manifest.iconColor : undefined,
              }
            } catch {
              // tolerate non-JSON; reachability is still useful
            }
          }
          setStatuses((prev) => ({ ...prev, [app.port]: info }))
        })
        .catch(() => setStatuses((prev) => ({ ...prev, [app.port]: { ok: false } })))
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
          {SUITE_APPS.map((app, i) => {
            const discovered = statuses[app.port]
            const isOffline = discovered?.ok === false
            const icon = discovered?.icon ?? app.icon
            const color = discovered?.color ?? app.color
            const description = discovered?.description ?? app.description
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
                    "--app-color": color,
                  } as React.CSSProperties
                }
              >
                <div className="app-switcher-row__icon">
                  <div className="app-switcher-row__icon-bg" />
                  <i className={cn(icon, "app-switcher-row__icon-i")} />
                </div>
                <div className="app-switcher-row__text">
                  <span className="app-switcher-row__name">
                    {allLetters.map((char, j) => (
                      <span
                        key={j}
                        className="app-switcher-row__letter inline-block"
                        style={{
                          "--letter-i": j,
                          color: j < mutedCount ? undefined : color,
                        } as React.CSSProperties}
                      >
                        {char}
                      </span>
                    ))}
                  </span>
                  <span className="app-switcher-row__desc">{description}</span>
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
