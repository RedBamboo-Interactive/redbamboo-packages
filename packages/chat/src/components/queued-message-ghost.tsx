import type { ReactNode } from "react"
import type { QueuedMessage } from "../lib/message-queue"
import { queuedMessageCanRetry, queuedMessageHasNothingToShow, queuedMessageSendBlockedReason, queuedMessageStatusLabel } from "../lib/queue-status"
import type { FriezeDensity, ImageAttachment } from "../types"
import { AttachmentCard } from "./attachment-card"
import { USER_BUBBLE_SHAPE_STYLE } from "./user-bubble-shape"
import { parseNovaEvent } from "../lib/nova-event"
import { eventQueueStatus, type EventSendAction } from "./event-queue-status"
import { NovaEventSquare } from "./nova-event-square"
import { ContextSquare, extractRawContextXml, parseContextFromMessage } from "./context-card"
import { stripHiddenMessageEnvelopes } from "../lib/message-content"
import { PART_COLOR } from "../lib/part-colors"

interface QueuedMessageGhostProps {
  item: QueuedMessage
  friezeDensity?: FriezeDensity
  onCancel: (id: string) => void
  onEdit: (id: string) => void
  onSendNow: (id: string) => void
  /** A queued event's send button. It is not a person's message, so it may steer where theirs interrupts. */
  onSendEvent?: (id: string) => void
  eventSend?: EventSendAction
  compactEventLabel?: string
  /** A waiting event's own row, already projected: its sender and origin, or its dot. */
  eventContent?: ReactNode
  /** The waiting event is a host's row, which has its own bubble: a second one around it reads as a box in a box. */
  eventDrawsOwnShape?: boolean
}

/**
 * A queued follow-up rendered where its user bubble will land once it sends —
 * dashed border + reduced opacity distinguish it from a delivered message.
 * The whole point of the queue is that this is never invisible.
 */
export function QueuedMessageGhost({ item, friezeDensity, onCancel, onEdit, onSendNow, onSendEvent, eventSend, compactEventLabel, eventContent, eventDrawsOwnShape }: QueuedMessageGhostProps) {
  if (item.kind === "inference-settings") {
    return (
      <div data-slot="queued-inference-settings" data-queue-item-id={item.remoteId ?? item.id}
        className="mb-3 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-muted">
        <i aria-hidden="true" className="ph-bold ph-sliders-horizontal" />
        <span className="min-w-0 break-words">{item.text}</span>
        <span className={item.deliveryError ? "text-destructive" : undefined}>
          {item.deliveryError ?? "Queued"}
        </span>
        {item.deliveryError && queuedMessageCanRetry(item) && (
          <button type="button" onClick={() => onSendNow(item.id)} className="hover:text-contrast">Retry</button>
        )}
        <button type="button" onClick={() => onCancel(item.id)} className="hover:text-contrast"
          aria-label="Cancel queued settings change">Cancel</button>
      </div>
    )
  }

  const messageAppearance = item.appearance === "message" || item.remoteState === "delivered"
  // Queued and immediately delivered submissions are the same outgoing message
  // entering the same timeline. The dashed styling communicates queue state;
  // both should get the established user-message spawn exactly once at mount.
  const entranceClass = "msg-enter-user"

  // A waiting event reads as a waiting message does: the same dashed shape, the same status line
  // below it. An event can't be pulled back into a draft, so there is no click to edit.
  if (eventContent || compactEventLabel) {
    const status = eventQueueStatus(item, onCancel, onSendEvent ?? onSendNow, eventSend)
    const label = status?.label ?? queuedMessageStatusLabel(item, true)
    return (
      <div
        className={`mb-3 ${entranceClass}`}
        data-slot="queued-nova-event"
        data-session-id={item.sessionId}
        data-queue-item-id={item.remoteId ?? item.id}
        data-queue-state={item.remoteState ?? (item.deliveryError ? "failed" : "pending")}
        data-input-message-uid={item.messageUid}
      >
        {compactEventLabel ? (
          <div data-slot="queued-event-line" className="flex min-w-0 items-center gap-2 px-0.5">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full border" style={{ borderColor: status?.failed ? PART_COLOR.error : PART_COLOR.delegation }} />
            <div className={`flex min-w-0 items-baseline text-xs italic ${status?.failed ? "text-red-400" : "text-text-muted"}`} title={`${compactEventLabel} · ${label}`}>
              <span className="min-w-0 truncate">{compactEventLabel}</span>
              <span className="shrink-0 whitespace-pre">{" · "}</span>
              <span className="min-w-0 shrink-0 max-w-[60%] truncate">{label}</span>
            </div>
            {status && <div className="flex shrink-0 items-center gap-1">{status.actions}</div>}
          </div>
        ) : (
          <>
            {eventDrawsOwnShape ? eventContent : (
              <div className="flex justify-end">
                <div
                  data-slot="queued-event-ghost"
                  className="min-w-0 max-w-[80%] border border-dashed border-overlay-20 bg-overlay-6 px-4 py-2.5 opacity-60 transition-opacity hover:opacity-90"
                  style={USER_BUBBLE_SHAPE_STYLE}
                >
                  {eventContent}
                </div>
              </div>
            )}
            <div className="flex items-center justify-end gap-1 mt-1">
              <span className={`text-[10px] italic mr-1 ${status?.failed ? "text-red-400" : "text-text-disabled"}`}>{label}</span>
              {status?.actions}
            </div>
          </>
        )}
      </div>
    )
  }

  const novaEvent = parseNovaEvent(item.text)

  if (novaEvent) {
    return (
      <div
        className={`mb-3 ${entranceClass}`}
        data-slot={messageAppearance ? "nova-event" : "queued-nova-event"}
        data-session-id={item.sessionId}
        data-queue-item-id={item.remoteId ?? item.id}
        data-queue-state={item.remoteState ?? (item.deliveryError ? "failed" : "pending")}
      >
        <NovaEventSquare event={novaEvent} friezeDensity={friezeDensity} queueStatus={eventQueueStatus(item, onCancel, onSendEvent ?? onSendNow, eventSend)} />
      </div>
    )
  }

  // An Agent's internal note (hidden envelope only) never was a person's message to show,
  // but once failed it blocks the queue, so its status and actions must still be reachable.
  if (queuedMessageHasNothingToShow(item) && item.remoteState !== "failed") return null
  const sendBlockedReason = queuedMessageSendBlockedReason(item)

  const contextData = parseContextFromMessage(item.text)
  const contextXml = contextData ? extractRawContextXml(item.text) : undefined
  const contextScreenshot = item.images?.[0]
  const visibleImages = item.images?.slice(contextData ? 1 : 0)
  const visibleText = stripHiddenMessageEnvelopes(item.text)
  const hasBubbleContent = !!visibleText || !!visibleImages?.length || !!item.attachments?.length

  return (
    <div
      className={`mb-3 ${entranceClass}`}
      data-slot={messageAppearance ? "outgoing-message" : "queued-message"}
      data-session-id={item.sessionId}
      data-queue-item-id={item.remoteId ?? item.id}
      data-queue-state={item.remoteState ?? (item.deliveryError ? "failed" : "pending")}
    >
      {contextData && (
        <ContextSquare context={{ ...contextData, screenshot: contextScreenshot }} rawXml={contextXml} />
      )}
      {hasBubbleContent && <div className="flex justify-end">
        <div
          onClick={() => { if (!messageAppearance && !item.admissionUncertain) onEdit(item.id) }}
          data-chat-user-bubble
          className={messageAppearance
            ? "relative max-w-[80%] bg-overlay-10 px-4 py-2.5"
            : `max-w-[80%] border border-dashed border-overlay-20 bg-overlay-6 px-4 py-2.5 opacity-60 transition-opacity hover:opacity-90 ${item.admissionUncertain ? "cursor-default" : "cursor-pointer"}`}
          style={USER_BUBBLE_SHAPE_STYLE}
          title={messageAppearance ? undefined : item.admissionUncertain ? "Retry to verify whether the server admitted this message" : "Click to edit"}
        >
          {visibleImages && visibleImages.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {visibleImages.map((img: ImageAttachment, i: number) => (
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
          {visibleText && <p className="text-sm whitespace-pre-wrap break-words font-serif">{visibleText}</p>}
        </div>
      </div>}
      {!messageAppearance && <div className="flex items-center justify-end gap-1 mt-1">
        <span className={`text-[10px] italic mr-1 ${item.deliveryError ? "text-red-400" : "text-text-disabled"}`}>
          {queuedMessageStatusLabel(item)}
        </span>
        {queuedMessageCanRetry(item) && <button
          disabled={!!sendBlockedReason}
          onClick={(e) => { e.stopPropagation(); onSendNow(item.id) }}
          className="w-5 h-5 flex items-center justify-center rounded text-text-disabled hover:text-amber-400 hover:bg-overlay-6 transition-colors disabled:opacity-40 disabled:pointer-events-none"
          title={sendBlockedReason ?? (item.deliveryError ? "Retry" : "Send now (interrupts the current turn)")}
          aria-label={item.deliveryError ? "Retry queued message" : "Send queued message now"}
        >
          <i className={`ph-bold ${item.deliveryError ? "ph-arrow-clockwise" : "ph-paper-plane-tilt"} text-[10px]`} />
        </button>}
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
