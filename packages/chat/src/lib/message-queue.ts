import { eventInputMessageUid } from "./event-parts.ts"
import type { ChatQueuedItem, ChatQueueSummary, ImageAttachment, MessageBlock, MessagePart, SendOptions, UploadedAttachment } from "../types"

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
  /** False when the server would refuse a retry of this failure. */
  deliveryRetryable?: boolean
  /** Canonical queue blocker, cleared once delivery is underway or complete. */
  blockedReason?: string
  remoteState?: "pending" | "delivering" | "failed" | "delivered"
  /** Human presentation. Idle submissions look like messages; genuinely waiting work looks queued. */
  appearance?: "message" | "queue"
  delivery?: "after-current" | "steer-current" | "interrupt-current"
  /** The server demoted a steer that raced an unavailable active turn. */
  steerUnavailable?: boolean
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

/** Finds a queue item from a projected input. Every member of a batch shares its delivered uid, so a member's own uid wins. */
export function queuedItemsByInputUid(queue: readonly QueuedMessage[]): Map<string, QueuedMessage> {
  const byUid = new Map<string, QueuedMessage>()
  for (const item of queue) {
    const uid = item.deliveredMessageUid ?? item.messageUid
    if (uid) byUid.set(uid, item)
  }
  for (const item of queue)
    if (item.messageUid) byUid.set(item.messageUid, item)
  return byUid
}

/** Where queued host events go for a host that places delivered ones (`queuedEventsWait`). */
export interface QueuedEventPlacement {
  /** The conversation: everything except the events that aren't in it yet. */
  messages: MessageBlock[]
  /** Inputs that are in the conversation, at the place the turn received them. */
  placedUids: Set<string>
  /** The projected part of each event still waiting, by queue item id. */
  waiting: Map<string, MessagePart>
}

/**
 * A queued event isn't in the conversation until it is processed, like a queued message. It waits
 * with the queue, and a delivered one whose canonical record hasn't arrived keeps waiting while the
 * turn runs (a steer is only folded in later; going inline first would move it twice). If the turn
 * ends with no record, it goes inline at its delivery time, as an outgoing message's bridge does.
 * An event with no queue item, or an unplaced one with no known state, is left exactly where it is:
 * nothing is hidden because its state is unknown. Returns `messages` itself when nothing moved.
 */
export function placeQueuedEvents(
  messages: MessageBlock[],
  queue: readonly QueuedMessage[],
  isStreaming: boolean,
): QueuedEventPlacement {
  const placedUids = new Set<string>()
  for (const message of messages) {
    if (message.role === "user") {
      placedUids.add(message.id)
      for (const uid of message.inputMessageUids ?? []) placedUids.add(uid)
    }
    for (const part of message.parts) {
      const uid = eventInputMessageUid(part)
      if (uid && part.inputPlaced) placedUids.add(uid)
    }
  }

  const waiting = new Map<string, MessagePart>()
  const byUid = new Map(queue.flatMap(item => item.messageUid && item.remoteState ? [[item.messageUid, item] as const] : []))
  if (byUid.size === 0) return { messages, placedUids, waiting }

  const bridged: MessageBlock[] = []
  let moved = false
  const remaining = messages.flatMap(block => {
    const parts = block.parts.filter(part => {
      const uid = eventInputMessageUid(part)
      const item = uid && !part.inputPlaced ? byUid.get(uid) : undefined
      if (!item) return true
      const deliveredAt = item.remoteState === "delivered" ? queuedMessageTimelineTimestamp(item) : Number.NaN
      if (item.remoteState === "delivered" && !isStreaming) {
        if (!Number.isFinite(deliveredAt)) return true
        bridged.push({ ...block, id: `event-${uid}`, parts: [part], timestamp: new Date(deliveredAt).toISOString() })
      } else {
        waiting.set(item.id, part)
      }
      moved = true
      return false
    })
    if (parts.length === block.parts.length) return [block]
    return parts.length > 0 ? [{ ...block, parts }] : []
  })
  if (!moved) return { messages, placedUids, waiting }

  for (const block of bridged) {
    const time = Date.parse(block.timestamp)
    const after = remaining.findIndex(other => Date.parse(other.timestamp) > time)
    remaining.splice(after < 0 ? remaining.length : after, 0, block)
  }
  return { messages: remaining, placedUids, waiting }
}

export interface RemoteMessageAdmission {
  disposition?: "queued" | "delivered"
  queueItemId?: string | null
  messageUid?: string | null
  deliveredMessageUid?: string | null
  item?: Partial<ChatQueuedItem> | null
  queue?: ChatQueueSummary | null
}

/** A delivery lease is not a wait. Only authoritative blocking corrects an immediate bubble. */
export function remoteMessageAppearance(
  state: QueuedMessage["remoteState"],
  previous: QueuedMessage["appearance"],
  queue?: ChatQueueSummary | null,
): QueuedMessage["appearance"] {
  if (state === "delivered") return "message"
  if (state === "failed" || state === "pending" && (queue?.state === "waiting_for_session" || !!queue?.blockedReason)) return "queue"
  return previous ?? "queue"
}

/** An admission acknowledgement can arrive after delivery has already been observed. */
export function acknowledgeRemoteMessage(message: QueuedMessage, admission: RemoteMessageAdmission | null): QueuedMessage {
  const delivered = message.remoteState === "delivered" || admission?.disposition === "delivered"
  const state = delivered ? "delivered" : !message.optimistic && message.remoteState && message.remoteState !== "pending"
    ? message.remoteState : admission?.item?.state === "cancelled" ? message.remoteState : admission?.item?.state ?? message.remoteState ?? (admission?.disposition === "queued" ? "pending" : undefined)
  return {
    ...message,
    remoteId: admission?.item?.id ?? admission?.queueItemId ?? message.remoteId,
    messageUid: admission?.item?.messageUid ?? admission?.messageUid ?? message.messageUid,
    deliveredMessageUid: message.deliveredMessageUid ?? admission?.item?.deliveredMessageUid ?? admission?.deliveredMessageUid ?? undefined,
    delivery: admission?.item?.delivery ?? message.delivery,
    remoteState: state,
    ...((admission?.item?.error?.code === "steer_unavailable" || message.steerUnavailable)
      ? { steerUnavailable: true } : {}),
    blockedReason: state === "delivered" || state === "delivering" ? undefined
      : !message.optimistic && message.remoteState ? message.blockedReason
      : admission?.queue?.blockedReason ?? message.blockedReason,
    appearance: remoteMessageAppearance(state, message.appearance, admission?.queue),
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

/**
 * A canonical message no longer needs its outgoing bridge, unless the queue still holds it as failed.
 * That row blocks everything behind it, so it stays visible even when the transcript shows the message.
 */
export function isVisibleOutgoingMessage(
  message: QueuedMessage,
  canonicalUserUids: ReadonlySet<string>,
): boolean {
  return message.remoteState === "failed" || !isCanonicalQueuedMessage(message, canonicalUserUids)
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
