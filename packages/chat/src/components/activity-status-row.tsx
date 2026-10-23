import { createContext, useContext, type ReactNode } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@redbamboo/ui"
import type { ActivityStatusItem } from "../types"

/**
 * The activity row is one status line: spinner, one shape per piece of work
 * behind the conversation, then one text. The panel renders the shapes once
 * and hands them to whichever status line occupies its status slot (the
 * host's session line, or its own background summary) through this context.
 * Status lines rendered anywhere else read nothing and show no shapes.
 */
const ActivityShapesContext = createContext<ReactNode>(null)

export const ActivityShapesProvider = ActivityShapesContext.Provider

export function useActivityShapes(): ReactNode {
  return useContext(ActivityShapesContext)
}

export interface ActivityShape {
  key: string
  label: string
  color: string
  shape: "square" | "circle"
  running: boolean
  onOpen: () => void
}

/** One clickable shape per running agent, background task and host item, in priority order. */
export function ActivityShapes({ shapes }: { shapes: readonly ActivityShape[] }) {
  if (shapes.length === 0) return null
  return (
    <div role="group" aria-label="Background work" data-slot="activity-shapes" className="flex shrink-0 flex-wrap items-center gap-[3px]">
      {shapes.map(shape => (
        <button
          key={shape.key}
          type="button"
          onClick={shape.onOpen}
          className={`w-2.5 h-2.5 ${shape.shape === "circle" ? "rounded-full" : "rounded-[2px]"} transition-colors duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer${shape.running ? " square-wobble" : ""}`}
          style={{ backgroundColor: shape.color }}
          title={shape.label}
          aria-label={shape.label}
          data-activity-key={shape.key}
          data-running={shape.running || undefined}
        />
      ))}
    </div>
  )
}

/** A host item's details, in the same dialog shell as an event's details. */
export function ActivityItemDialog({ item, onClose }: { item: ActivityStatusItem | null; onClose: () => void }) {
  return (
    <Dialog open={!!item} onOpenChange={open => { if (!open) onClose() }}>
      {item && (
        <DialogContent motion="snappy" className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <div className={`w-3 h-3 shrink-0 ${item.shape === "circle" ? "rounded-full" : "rounded-[2px]"}`} style={{ backgroundColor: item.color }} />
            <DialogTitle className="text-sm truncate">{item.title}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto p-4 flex-1 min-h-0">{item.renderDetails(onClose)}</div>
        </DialogContent>
      )}
    </Dialog>
  )
}
