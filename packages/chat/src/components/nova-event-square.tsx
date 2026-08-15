import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@redbamboo/ui"
import type { NovaEvent } from "../lib/nova-event"

const EVENT_COLOR = "var(--color-status-live)"

function novaEventIcon(type: string): string {
  switch (type) {
    case "http-check": return "ph-bold ph-broadcast"
    case "ai-session": return "ph-bold ph-brain"
    default: return "ph-bold ph-lightning"
  }
}

export function NovaEventSquare({ event }: { event: NovaEvent }) {
  const [open, setOpen] = useState(false)
  const displaySource = event.source.replace(/^automation:/, "")

  return (
    <div className="py-1.5 px-0.5">
      <button
        onClick={() => setOpen(true)}
        className="w-2.5 h-2.5 rounded-[2px] transition-all duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer square-spawn"
        style={{ backgroundColor: EVENT_COLOR }}
        title={displaySource}
      />

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: EVENT_COLOR }} />
            <i className={`${novaEventIcon(event.type)} text-sm text-status-live`} />
            <DialogTitle className="text-sm">{displaySource}</DialogTitle>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-disabled">
              {event.type}
            </span>
          </DialogHeader>

          <div className="overflow-y-auto p-4 flex-1 min-h-0">
            <p className="text-sm text-text-primary font-serif whitespace-pre-wrap">{event.content}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
