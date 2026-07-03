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

export interface SwitcherAppStatus {
  label: string
  /** Badge accent color (hex). */
  color?: string
}

/**
 * An app entry supplied by the host instead of Red Suite port discovery.
 * Used by Leaf, where apps are plugin routes on the same origin.
 */
export interface SwitcherApp {
  id: string
  name: string
  /** Two-tone rendering: first part muted, rest in the accent color. Defaults to the full name in the accent color. */
  nameParts?: [string, string]
  icon: string
  color?: string
  description?: string
  /** Status badge shown next to the name (e.g. tripped/mismatch). */
  status?: SwitcherAppStatus
  /** Grayed out and not selectable (like an offline suite app). */
  disabled?: boolean
  active?: boolean
  onSelect?: () => void
}

export interface AppSwitcherProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When provided, these apps replace the port-scanning Red Suite discovery. */
  apps?: SwitcherApp[]
}

interface SwitcherRow {
  key: string
  letters: string[]
  mutedCount: number
  icon: string
  color?: string
  description?: string
  status?: SwitcherAppStatus
  disabled: boolean
  active: boolean
  href?: string
  onSelect?: () => void
}

function AppSwitcher({ open, onOpenChange, apps }: AppSwitcherProps) {
  const statuses = useAppDiscovery(open && !apps)
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

  const rows: SwitcherRow[] = apps
    ? apps.map((app) => {
        const parts = app.nameParts ?? ["", app.name]
        return {
          key: app.id,
          letters: (parts[0] + parts[1]).split(""),
          mutedCount: parts[0].length,
          icon: app.icon,
          color: app.color,
          description: app.description,
          status: app.status,
          disabled: app.disabled ?? false,
          active: app.active ?? false,
          onSelect: app.onSelect,
        }
      })
    : SUITE_APPS.map((app) => {
        const discovered = statuses[app.port]
        return {
          key: String(app.port),
          letters: (app.nameParts[0] + app.nameParts[1]).split(""),
          mutedCount: app.nameParts[0].length,
          icon: discovered?.icon ?? app.icon,
          color: discovered?.color ?? app.color,
          description: discovered?.description ?? app.description,
          disabled: discovered?.ok === false,
          active: String(app.port) === currentPort,
          href: `${baseUrl}:${app.port}`,
          onSelect: undefined,
        }
      })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="w-72 sm:max-w-none p-2">
        <div className="app-switcher-list">
          {rows.map((row, i) => (
            <a
              key={row.key}
              href={row.href}
              target={row.href ? "_blank" : undefined}
              rel={row.href ? "noopener noreferrer" : undefined}
              onClick={(e) => {
                e.preventDefault()
                if (row.disabled) return
                if (!row.active) {
                  if (row.onSelect) {
                    row.onSelect()
                  } else if (row.href) {
                    window.open(row.href, "_blank", "noopener,noreferrer")
                  }
                }
                onOpenChange(false)
              }}
              className={cn(
                "app-switcher-row",
                entered && "app-switcher-row--entered",
                row.disabled && "app-switcher-row--offline",
                row.active && "app-switcher-row--active",
              )}
              style={
                {
                  "--tile-i": i,
                  "--app-color": row.color,
                } as React.CSSProperties
              }
            >
              <div className="app-switcher-row__icon">
                <div className="app-switcher-row__icon-bg" />
                <i className={cn(row.icon, "app-switcher-row__icon-i")} />
              </div>
              <div className="app-switcher-row__text">
                <span className="app-switcher-row__name">
                  {row.letters.map((char, j) => (
                    <span
                      key={j}
                      className="app-switcher-row__letter inline-block"
                      style={{
                        "--letter-i": j,
                        color: j < row.mutedCount ? undefined : row.color,
                      } as React.CSSProperties}
                    >
                      {char === " " ? " " : char}
                    </span>
                  ))}
                  {row.status && (
                    <span
                      className="app-switcher-row__badge"
                      style={{ "--badge-color": row.status.color ?? "var(--color-muted-foreground)" } as React.CSSProperties}
                    >
                      {row.status.label}
                    </span>
                  )}
                </span>
                <span className="app-switcher-row__desc">{row.description}</span>
              </div>
            </a>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  )
}

export { AppSwitcher }
