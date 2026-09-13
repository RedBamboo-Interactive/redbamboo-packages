import type { ReactNode } from "react"
import type { QueuedMessage } from "../lib/message-queue"
import type { MessagePart } from "../types"

export interface EventQueueStatus {
  label: string
  failed: boolean
  actions: ReactNode
}

export type ResolveEventQueueStatus = (part: MessagePart) => EventQueueStatus | undefined

export function eventQueueStatus(
  item: QueuedMessage | undefined,
  onCancel: (id: string) => void,
  onSendNow: (id: string) => void,
): EventQueueStatus | undefined {
  if (!item || item.appearance === "message" || item.remoteState === "delivered") return undefined
  return {
    label: item.deliveryError
      || (item.remoteState === "delivering" ? "Delivering update"
        : item.delivery === "interrupt-current" ? "Queued, interruption requested" : "Queued, sends after this turn"),
    failed: !!item.deliveryError,
    actions: <>
      <button
        onClick={() => onSendNow(item.id)}
        className="w-5 h-5 flex items-center justify-center rounded text-text-disabled hover:text-amber-400 hover:bg-overlay-6 transition-colors"
        title={item.deliveryError ? "Retry" : "Send now (interrupts the current turn)"}
        aria-label={item.deliveryError ? "Retry queued event" : "Send queued event now"}
      >
        <i className={`ph-bold ${item.deliveryError ? "ph-arrow-clockwise" : "ph-paper-plane-tilt"} text-[10px]`} />
      </button>
      {!item.admissionUncertain && <button
        onClick={() => onCancel(item.id)}
        className="w-5 h-5 flex items-center justify-center rounded text-text-disabled hover:text-red-400 hover:bg-overlay-6 transition-colors"
        title="Cancel"
        aria-label="Cancel queued event"
      >
        <i className="ph-bold ph-x text-[10px]" />
      </button>}
    </>,
  }
}

export function EventQueueStatusBar({ status }: { status?: EventQueueStatus }) {
  if (!status) return null
  return <div data-slot="nova-event-queue-status" className="flex items-center gap-2 px-4 py-2 border-b border-border-subtle shrink-0">
    <span className={`text-xs flex-1 ${status.failed ? "text-red-400" : "text-text-muted"}`}>{status.label}</span>
    {status.actions}
  </div>
}
