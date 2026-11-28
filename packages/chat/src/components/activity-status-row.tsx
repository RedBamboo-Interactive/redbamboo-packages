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

/**
 * Background work beside a turn that is still working: one short text after the
 * session's own, so the row says what the shapes are without a hover.
 */
export interface ActivityNoteValue {
  label: string
  title?: string
  onOpen?: () => void
}

const ActivityNoteContext = createContext<ActivityNoteValue | null>(null)

export const ActivityNoteProvider = ActivityNoteContext.Provider

/** Text that opens the work it names; plain text when there is nothing to open. */
export function ActivityText({ label, title, onOpen, className = "" }: ActivityNoteValue & { className?: string }) {
  if (!onOpen) return <span className={`truncate min-w-0 ${className}`} title={title}>{label}</span>
  return (
    <button type="button" onClick={onOpen} title={title} data-slot="activity-open"
      className={`flex min-w-0 items-center gap-1 cursor-pointer hover:text-muted-foreground transition-colors text-left ${className}`}>
      <span className="truncate">{label}</span>
      <i aria-hidden className="ph-bold ph-caret-right text-[9px] opacity-60 shrink-0" />
    </button>
  )
}

/** The note in whichever status line occupies the panel's status slot. */
export function ActivityNote() {
  const note = useContext(ActivityNoteContext)
  if (!note) return null
  return (
    <>
      <span aria-hidden className="opacity-40 shrink-0">·</span>
      <ActivityText {...note} className="shrink-[100]" />
    </>
  )
}

export interface ActivityShape {
  key: string
  label: string
  color: string
  /** A twin (two squares and their gap) is a job. */
  shape: "square" | "circle" | "twin"
  running: boolean
  onOpen: () => void
}

/** The shape's footprint: a twin is as wide as two squares and their gap, and never scales up on hover. */
function shapeClass(shape: ActivityShape["shape"]): string {
  if (shape === "twin") return "w-[23px] h-2.5 rounded-[2px]"
  return `w-2.5 h-2.5 ${shape === "circle" ? "rounded-full" : "rounded-[2px]"}`
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
          className={`activity-marker ${shapeClass(shape.shape)} cursor-pointer${shape.running ? " square-wobble" : ""}`}
          data-activity-wide={shape.shape === "twin" || undefined}
          title={shape.label}
          aria-label={shape.label}
          data-activity-key={shape.key}
          data-running={shape.running || undefined}
        >
          <span aria-hidden="true" className="activity-marker-visual" style={{ backgroundColor: shape.color }} />
        </button>
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
            <div className={`h-3 shrink-0 ${item.shape === "twin" ? "w-[27px] rounded-[2px]" : item.shape === "circle" ? "w-3 rounded-full" : "w-3 rounded-[2px]"}`} style={{ backgroundColor: item.color }} />
            <DialogTitle className="text-sm truncate">{item.title}</DialogTitle>
          </DialogHeader>
          <div className="overflow-y-auto p-4 flex-1 min-h-0">{item.renderDetails(onClose)}</div>
        </DialogContent>
      )}
    </Dialog>
  )
}
