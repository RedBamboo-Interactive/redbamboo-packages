import {
  cn,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@redbamboo/ui"
import type { SwitcherApp } from "./app-switcher"

export interface AppMenuProps {
  /** Apps listed in the dropdown, in display order. */
  apps: SwitcherApp[]
  /** Controlled open state — lets a shell command open the menu programmatically. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Trigger content — typically an AppHeaderBrand with a caret. */
  children: React.ReactNode
}

/**
 * Compact app switcher rendered as a dropdown anchored at the header brand.
 * The dropdown alternative to the {@link AppSwitcher} modal: same SwitcherApp
 * row model (icon, two-tone name, status badge, disabled), no port discovery.
 */
function AppMenu({ apps, open, onOpenChange, children }: AppMenuProps) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            data-slot="app-menu-trigger"
            className="shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        {children}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {apps.map((app) => {
          const parts = app.nameParts ?? ["", app.name]
          return (
            <DropdownMenuItem
              key={app.id}
              disabled={app.disabled}
              onClick={() => {
                if (!app.active) app.onSelect?.()
              }}
              className={cn(app.active && "bg-overlay-6")}
            >
              <span
                className="relative flex size-6 shrink-0 items-center justify-center rounded"
                style={{ color: app.color ?? "var(--color-muted-foreground)" }}
              >
                <span className="absolute inset-0 rounded bg-current opacity-15" />
                <i className={cn(app.icon, "relative text-xs")} />
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium">
                {app.name}
              </span>
              {app.status ? (
                <span
                  className="ml-auto shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide"
                  style={{
                    color: app.status.color ?? "var(--color-muted-foreground)",
                    background: "color-mix(in srgb, currentColor 15%, transparent)",
                  }}
                >
                  {app.status.label}
                </span>
              ) : app.active ? (
                <i className="fa-solid fa-check ml-auto shrink-0 text-[10px] text-muted-foreground" />
              ) : null}
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AppMenu }
