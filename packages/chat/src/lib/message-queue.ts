import { eventInputMessageUid } from "./event-parts.ts"
import type { ChatQueuedItem, ImageAttachment, MessageBlock, SendOptions, UploadedAttachment } from "../types"

export interface QueuedMessage {
  /** Stable presentation identity. For remote items this remains the client id across acknowledgement. */
  id: string
  /** Canonical server queue id used by queue mutation APIs. */
  remoteId?: string
  /** Server-returned idempotency key used to replace an uncertain local outbox ghost. */
  clientId?: string
  sessionId?: string
  text: string
  images?: ImageAttachment[]
  attachments?: UploadedAttachment[]
  deliveryError?: string
  remoteState?: "pending" | "delivering" | "failed" | "delivered"
  /** Human presentation. Idle submissions look like messages; genuinely waiting work looks queued. */
  appearance?: "message" | "queue"
  delivery?: "after-current" | "interrupt-current"
  messageUid?: string
  deliveredMessageUid?: string
  /** Submission time used to place an optimistic idle bubble in the timeline. */
  createdAt?: string
  /** Canonical delivery time used when a waiting queue item becomes a message. */
  deliveredAt?: string
  /**
   * Stable visual position for the outgoing bridge. Immediate sends keep their
   * submission time; follow-ups authored during another turn acquire this only
   * when they are delivered. This prevents a fast assistant event from sorting
   * above the user input that caused it without moving queued work into the
   * middle of the turn it was waiting behind.
   */
  timelineAt?: string
  optimistic?: boolean
  /** A transport failure means the server may have admitted this turn despite no acknowledgement. */
  admissionUncertain?: boolean
}

/** One identity shared by the optimistic bubble, durable queue, and transcript. */
export function createRemoteMessageIdentity(
  uuid = globalThis.crypto.randomUUID(),
): Pick<QueuedMessage, "id" | "messageUid"> {
  const messageUid = uuid.replaceAll("-", "")
  return { id: `q-${messageUid}`, messageUid }
}

/** Preserve one remote submission identity across first admission and outbox recovery. */
export function remoteSubmissionOptions(
  entry: QueuedMessage,
  options?: SendOptions,
): SendOptions {
  return {
    ...options,
    delivery: options?.delivery ?? entry.delivery ?? "after-current",
    idempotencyKey: entry.id,
    messageUid: entry.messageUid,
    displayContent: entry.text,
  }
}

/** Inputs represented by user messages or projected host events; never assistant replies. */
export function canonicalUserMessageUids(messages: readonly MessageBlock[]): Set<string> {
  return new Set(messages.flatMap(message => [
    ...(message.role === "user" ? [message.id, ...(message.inputMessageUids ?? [])] : []),
    ...message.parts.flatMap(part => {
      const uid = eventInputMessageUid(part)
      return uid ? [uid] : []
    }),
  ]))
}

export interface RemoteMessageAdmission {
  disposition?: "queued" | "delivered"
  queueItemId?: string | null
  messageUid?: string | null
  deliveredMessageUid?: string | null
  item?: Partial<ChatQueuedItem> | null
}

/** An admission acknowledgement can arrive after delivery has already been observed. */
export function acknowledgeRemoteMessage(message: QueuedMessage, admission: RemoteMessageAdmission | null): QueuedMessage {
  const delivered = message.remoteState === "delivered" || admission?.disposition === "delivered"
  return {
    ...message,
    remoteId: admission?.item?.id ?? admission?.queueItemId ?? message.remoteId,
    messageUid: admission?.item?.messageUid ?? admission?.messageUid ?? message.messageUid,
    deliveredMessageUid: message.deliveredMessageUid ?? admission?.item?.deliveredMessageUid ?? admission?.deliveredMessageUid ?? undefined,
    remoteState: delivered ? "delivered" : admission?.item?.state === "cancelled" ? message.remoteState : admission?.item?.state ?? message.remoteState,
    appearance: delivered ? "message" : message.appearance,
    timelineAt: message.timelineAt ?? (delivered ? new Date().toISOString() : undefined),
    optimistic: false,
  }
}

/** True once the transcript already represents this outgoing bridge. */
export function isCanonicalQueuedMessage(
  message: QueuedMessage,
  canonicalUserUids: ReadonlySet<string>,
): boolean {
  return (!!message.messageUid && canonicalUserUids.has(message.messageUid))
    || (!!message.deliveredMessageUid && canonicalUserUids.has(message.deliveredMessageUid))
}

/** Timestamp used when an outgoing bridge is merged with transcript rows. */
export function queuedMessageTimelineTimestamp(message: QueuedMessage): number {
  return Date.parse(message.timelineAt ?? message.deliveredAt ?? message.createdAt ?? "")
}

export function enqueue(queue: QueuedMessage[], entry: QueuedMessage): QueuedMessage[] {
  return [...queue, entry]
}

export function cancel(queue: QueuedMessage[], id: string): QueuedMessage[] {
  return queue.filter(m => m.id !== id)
}

/** Joins every queued entry into the single turn that gets sent when the queue drains. */
export function coalesce(queue: QueuedMessage[]): { text: string; images?: ImageAttachment[]; attachments?: UploadedAttachment[] } | null {
  if (queue.length === 0) return null
  const text = queue.map(m => m.text).join("\n")
  const images = queue.flatMap(m => m.images ?? [])
  const attachments = queue.flatMap(m => m.attachments ?? [])
  return { text, images: images.length > 0 ? images : undefined, attachments: attachments.length > 0 ? attachments : undefined }
}

export interface DrainConditions {
  queueLength: number
  isStreaming: boolean
  disabled: boolean
  /**
   * The window after the backend reports its CLI process was force-killed and
   * is being replaced: `isStreaming` is already false there, but writing new
   * input would race the resume (see process-stream-event.ts's "killed"
   * handling).
   */
  resumePending?: boolean
  /**
   * The agent asked the user a question and is blocked on the answer. The
   * session is still Active server-side, but `isStreaming` is forced false so
   * the answer box works — draining here would post a plain message into a
   * turn waiting on `onAnswerQuestion`, which is a different endpoint.
   */
  questionPending?: boolean
}

/** Every condition is a veto; the queue only moves when all of them agree. */
export function shouldDrain({
  queueLength,
  isStreaming,
  disabled,
  resumePending = false,
  questionPending = false,
}: DrainConditions): boolean {
  return queueLength > 0 && !isStreaming && !disabled && !resumePending && !questionPending
}

/**
 * One atomic drain: coalesces the whole queue into a single send and empties
 * it. Calling this again on the `remaining` result is a no-op (coalesce
 * returns null on an empty queue) — the property the hook's settle timer
 * relies on to survive firing twice for the same drain.
 */
export function drainStep(queue: QueuedMessage[]): { sent: { text: string; images?: ImageAttachment[]; attachments?: UploadedAttachment[] }; remaining: QueuedMessage[] } | null {
  const sent = coalesce(queue)
  if (!sent) return null
  return { sent, remaining: [] }
}
