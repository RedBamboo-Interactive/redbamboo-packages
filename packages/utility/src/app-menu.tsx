import { useState, useCallback } from "react"
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
  /** Controlled open state -- lets a shell command open the menu programmatically. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** When provided, items become drag-reorderable and the callback receives the new id order. */
  onReorder?: (ids: string[]) => void
  /** Trigger content -- typically an AppHeaderBrand with a caret. */
  children: React.ReactNode
}

function AppItemContent({ app, showGrip }: { app: SwitcherApp; showGrip: boolean }) {
  return (
    <>
      {showGrip && (
        <i className="ph-bold ph-dots-six-vertical shrink-0 text-xs text-muted-foreground opacity-0 group-hover/row:opacity-100 transition-opacity cursor-grab" />
      )}
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
      {(app.badge ?? 0) > 0 && (
        <span
          className="shrink-0 min-w-4 rounded-full bg-primary text-primary-foreground text-[10px] px-1 text-center font-medium leading-4"
          title={app.badgeTooltip}
        >
          {app.badge! > 99 ? "99+" : app.badge}
        </span>
      )}
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
      ) : (
        <i className={cn("ph-bold ph-check ml-auto shrink-0 text-[10px] text-muted-foreground", !app.active && "invisible")} />
      )}
    </>
  )
}

function AppMenu({ apps, open, onOpenChange, onReorder, children: triggerChildren }: AppMenuProps) {
  const hasUnread = apps.some((a) => (a.badge ?? 0) > 0)
  const [dragSourceId, setDragSourceId] = useState<string | null>(null)
  const [dropIndicator, setDropIndicator] = useState<{
    idx: number
    position: "before" | "after"
  } | null>(null)

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && dragSourceId) return
      onOpenChange?.(next)
    },
    [onOpenChange, dragSourceId],
  )

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.effectAllowed = "move"
    e.dataTransfer.setData("text/plain", id)
    setDragSourceId(id)
  }, [])

  const handleDragOver = useCallback((e: React.DragEvent, idx: number) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    const rect = e.currentTarget.getBoundingClientRect()
    const midY = rect.top + rect.height / 2
    setDropIndicator({ idx, position: e.clientY < midY ? "before" : "after" })
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (!dragSourceId || !dropIndicator || !onReorder) {
        setDragSourceId(null)
        setDropIndicator(null)
        return
      }

      const sourceIdx = apps.findIndex((a) => a.id === dragSourceId)
      if (sourceIdx !== -1) {
        let targetIdx =
          dropIndicator.position === "after"
            ? dropIndicator.idx + 1
            : dropIndicator.idx
        if (sourceIdx < targetIdx) targetIdx--

        if (sourceIdx !== targetIdx) {
          const ids = apps.map((a) => a.id)
          const [moved] = ids.splice(sourceIdx, 1)
          ids.splice(targetIdx, 0, moved)
          onReorder(ids)
        }
      }

      setDragSourceId(null)
      setDropIndicator(null)
    },
    [apps, dragSourceId, dropIndicator, onReorder],
  )

  const handleDragEnd = useCallback(() => {
    setDragSourceId(null)
    setDropIndicator(null)
  }, [])

  return (
    <DropdownMenu open={open} onOpenChange={onReorder ? handleOpenChange : onOpenChange}>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            data-slot="app-menu-trigger"
            className="shrink-0 rounded outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        }
      >
        <div className="relative">
          {triggerChildren}
          {hasUnread && (
            <span className="absolute -top-0.5 -right-1 size-2 rounded-full bg-primary" />
          )}
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        <div
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) {
              setDropIndicator(null)
            }
          }}
        >
          {apps.map((app, idx) => {
            if (onReorder) {
              const isDragSource = dragSourceId === app.id
              const showBefore =
                dropIndicator?.idx === idx &&
                dropIndicator.position === "before" &&
                !isDragSource
              const showAfter =
                dropIndicator?.idx === idx &&
                dropIndicator.position === "after" &&
                !isDragSource

              return (
                <div
                  key={app.id}
                  className="relative"
                  onDragOver={(e) => handleDragOver(e, idx)}
                  onDrop={handleDrop}
                >
                  {showBefore && (
                    <div className="absolute top-0 left-2 right-2 h-0.5 -translate-y-px rounded-full bg-primary z-10" />
                  )}
                  <div
                    draggable
                    onDragStart={(e) => handleDragStart(e, app.id)}
                    onDragEnd={handleDragEnd}
                    onClick={() => {
                      if (app.disabled) return
                      if (!app.active) app.onSelect?.()
                      onOpenChange?.(false)
                    }}
                    className={cn(
                      "group/row relative flex cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
                      app.disabled && "pointer-events-none opacity-50",
                      app.active && "bg-overlay-6",
                      isDragSource && "opacity-40",
                    )}
                  >
                    <AppItemContent app={app} showGrip />
                  </div>
                  {showAfter && (
                    <div className="absolute bottom-0 left-2 right-2 h-0.5 translate-y-px rounded-full bg-primary z-10" />
                  )}
                </div>
              )
            }

            return (
              <DropdownMenuItem
                key={app.id}
                disabled={app.disabled}
                onClick={() => {
                  if (!app.active) app.onSelect?.()
                }}
                className={cn(app.active && "bg-overlay-6")}
              >
                <AppItemContent app={app} showGrip={false} />
              </DropdownMenuItem>
            )
          })}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { AppMenu }
