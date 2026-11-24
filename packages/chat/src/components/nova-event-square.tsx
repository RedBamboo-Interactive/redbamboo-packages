import { EventQueueStatusBar, type EventQueueStatus } from "./event-queue-status"
import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@redbamboo/ui"
import type { NovaEvent } from "../lib/nova-event"
import type { FriezeDensity } from "../types"
import { friezeMarkerPaint } from "../lib/frieze-presentation"
import { FriezeDisclosure } from "./frieze-disclosure"

const EVENT_COLOR = "var(--color-status-live)"

function novaEventIcon(type: string): string {
  switch (type) {
    case "http-check": return "ph-bold ph-broadcast"
    case "ai-session": return "ph-bold ph-brain"
    default: return "ph-bold ph-lightning"
  }
}

interface NovaEventSquareProps {
  event: NovaEvent
  friezeDensity?: FriezeDensity
  /** Pending internal inputs stay compact; their delivery controls live in the details. */
  queueStatus?: EventQueueStatus
}

export function NovaEventSquare({ event, queueStatus, friezeDensity = "detailed" }: NovaEventSquareProps) {
  const [open, setOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const displaySource = event.source.replace(/^automation:/, "")
  const color = queueStatus?.failed ? "var(--color-red-400)" : EVENT_COLOR
  const label = queueStatus ? `${displaySource}: ${queueStatus.label}` : displaySource

  const paint = friezeMarkerPaint(friezeDensity, color, { failed: queueStatus?.failed })
  const marker = (
    <button
      onClick={() => setOpen(true)}
      className={`w-2.5 h-2.5 rounded-[2px] transition-all duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer square-spawn${paint.highlight ? " quiet-frieze-marker" : ""}`}
      style={{
        backgroundColor: paint.color,
        ...paint.highlight,
        ...(friezeDensity === "quiet" ? { width: 8, height: 8 } : {}),
      }}
      title={label}
      aria-label={label}
    />
  )

  return (
    <div className="py-1.5 px-0.5">
      {friezeDensity === "minimal" ? (
        <>
          <FriezeDisclosure count={1} eventOnly failed={queueStatus?.failed ? 1 : 0}
            expanded={expanded} onToggle={() => setExpanded(value => !value)} />
          {expanded && <div className="flex pt-1">{marker}</div>}
        </>
      ) : marker}

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent motion="snappy" className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: color }} />
            <i className={`${novaEventIcon(event.type)} text-sm text-status-live`} />
            <DialogTitle className="text-sm">{displaySource}</DialogTitle>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-disabled">
              {event.type}
            </span>
          </DialogHeader>

          <EventQueueStatusBar status={queueStatus} />
          <div className="overflow-y-auto p-4 flex-1 min-h-0">
            <p className="text-sm text-text-primary font-serif whitespace-pre-wrap">{event.content}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
