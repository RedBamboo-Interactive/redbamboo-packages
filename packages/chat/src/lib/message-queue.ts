import type { ImageAttachment, UploadedAttachment } from "../types"

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
  optimistic?: boolean
  /** A transport failure means the server may have admitted this turn despite no acknowledgement. */
  admissionUncertain?: boolean
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
