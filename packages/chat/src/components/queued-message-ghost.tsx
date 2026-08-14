import { useRef } from "react"
import type { QueuedMessage } from "../lib/message-queue"
import type { ImageAttachment } from "../types"
import { AttachmentCard } from "./attachment-card"
import { USER_BUBBLE_SHAPE_STYLE } from "./user-bubble-shape"

interface QueuedMessageGhostProps {
  item: QueuedMessage
  onCancel: (id: string) => void
  onEdit: (id: string) => void
  onSendNow: (id: string) => void
}

/**
 * A queued follow-up rendered where its user bubble will land once it sends —
 * dashed border + reduced opacity distinguish it from a delivered message.
 * The whole point of the queue is that this is never invisible.
 */
export function QueuedMessageGhost({ item, onCancel, onEdit, onSendNow }: QueuedMessageGhostProps) {
  const messageAppearance = item.appearance === "message" || item.remoteState === "delivered"
  // An idle submission animates once as a normal message. A genuine queue item
  // becoming delivered keeps the same node and simply loses its queue styling.
  const initialMessageAppearance = useRef(messageAppearance).current
  const entranceClass = initialMessageAppearance ? "msg-enter-user" : "msg-enter-queue"
  return (
    <div
      className={`mb-3 ${entranceClass}`}
      data-slot={messageAppearance ? "outgoing-message" : "queued-message"}
      data-session-id={item.sessionId}
      data-queue-item-id={item.remoteId ?? item.id}
      data-queue-state={item.remoteState ?? (item.deliveryError ? "failed" : "pending")}
    >
      <div className="flex justify-end">
        <div
          onClick={() => { if (!messageAppearance && !item.admissionUncertain) onEdit(item.id) }}
          data-chat-user-bubble
          className={messageAppearance
            ? "relative max-w-[80%] bg-overlay-10 px-4 py-2.5"
            : `max-w-[80%] border border-dashed border-overlay-20 bg-overlay-6 px-4 py-2.5 opacity-60 transition-opacity hover:opacity-90 ${item.admissionUncertain ? "cursor-default" : "cursor-pointer"}`}
          style={USER_BUBBLE_SHAPE_STYLE}
          title={messageAppearance ? undefined : item.admissionUncertain ? "Retry to verify whether the server admitted this message" : "Click to edit"}
        >
          {item.images && item.images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {item.images.map((img: ImageAttachment, i: number) => (
                <img
                  key={i}
                  src={`data:${img.mediaType};base64,${img.base64}`}
                  alt=""
                  className="max-h-32 rounded-md border border-overlay-10"
                />
              ))}
            </div>
          )}
          {item.attachments && item.attachments.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {item.attachments.map(attachment => attachment.kind === "image" ? (
                <img key={attachment.id} src={attachment.downloadUrl} alt={attachment.name} className="h-16 w-16 object-cover rounded-md border border-overlay-10" />
              ) : (
                <AttachmentCard key={attachment.id} attachment={attachment} compact />
              ))}
            </div>
          )}
          {item.text && <p className="text-sm whitespace-pre-wrap break-words font-serif">{item.text}</p>}
        </div>
      </div>
      {!messageAppearance && <div className="flex items-center justify-end gap-1 mt-1">
        <span className={`text-[10px] italic mr-1 ${item.deliveryError ? "text-red-400" : "text-text-disabled"}`}>
          {item.deliveryError
            || (item.delivery === "interrupt-current" ? "Queued, interruption requested" : "Queued, sends after this turn")}
        </span>
        <button
          onClick={(e) => { e.stopPropagation(); onSendNow(item.id) }}
          className="w-5 h-5 flex items-center justify-center rounded text-text-disabled hover:text-amber-400 hover:bg-overlay-6 transition-colors"
          title={item.deliveryError ? "Retry" : "Send now (interrupts the current turn)"}
          aria-label={item.deliveryError ? "Retry queued message" : "Send queued message now"}
        >
          <i className={`ph-bold ${item.deliveryError ? "ph-arrow-clockwise" : "ph-paper-plane-tilt"} text-[10px]`} />
        </button>
        {!item.admissionUncertain && (
          <button
            onClick={(e) => { e.stopPropagation(); onCancel(item.id) }}
            className="w-5 h-5 flex items-center justify-center rounded text-text-disabled hover:text-red-400 hover:bg-overlay-6 transition-colors"
            title="Cancel"
            aria-label="Cancel queued message"
          >
            <i className="ph-bold ph-x text-[10px]" />
          </button>
        )}
      </div>}
    </div>
  )
}
