import type { QueuedMessage } from "./message-queue"
import { stripHiddenMessageEnvelopes } from "./message-content.ts"

export function maintenanceBlocksQueuedMessage(item: QueuedMessage): boolean {
  return item.remoteState === "pending" && !item.deliveryError && !item.admissionUncertain
    && (item.blockedReason === "maintenance_drain" || item.blockedReason === "maintenance")
}

/** Waiting behind a failed input: nothing sends until that input is cancelled or retried. */
export function failedHeadBlocksQueuedMessage(item: QueuedMessage): boolean {
  return item.remoteState === "pending" && !item.deliveryError && !item.admissionUncertain
    && item.blockedReason === "failed_head"
}

/** Why this row's send action cannot do anything, when it can't. */
export function queuedMessageSendBlockedReason(item: QueuedMessage): string | undefined {
  if (maintenanceBlocksQueuedMessage(item)) return "Message delivery is paused for an update"
  if (failedHeadBlocksQueuedMessage(item)) return "Cancel or retry the failed message first"
  return undefined
}

/** The server refuses to retry this failure, so offering Retry would be a dead button. */
export function queuedMessageCanRetry(item: QueuedMessage): boolean {
  return item.deliveryRetryable !== false
}

export function queuedMessageStatusLabel(item: QueuedMessage, internalEvent = false): string {
  if (item.deliveryError) return item.deliveryError
  if (maintenanceBlocksQueuedMessage(item)) return "Saved, waiting for the update to finish"
  if (failedHeadBlocksQueuedMessage(item)) return "Blocked by an earlier failed message"
  // A receipt whose transcript copy hasn't arrived: it reached the provider, so it no longer waits for a turn.
  if (item.remoteState === "delivered" && item.delivery !== "steer-current")
    return internalEvent ? "Delivering update" : "Delivering message"
  if (item.steerUnavailable) return "Sends after this turn"
  if (item.delivery === "steer-current") return "Sending into this turn"
  if (item.remoteState === "delivering") return internalEvent ? "Delivering update" : "Delivering message"
  return item.delivery === "interrupt-current" ? "Queued, interruption requested" : "Queued, sends after this turn"
}

/**
 * Queued input with nothing for a person to see: only hidden envelopes (an Agent's internal note,
 * such as Nova's reaction note), no context card, no attachment. Its ghost would be an empty bubble.
 */
export function queuedMessageHasNothingToShow(item: Pick<QueuedMessage, "text" | "images" | "attachments">): boolean {
  if (item.images?.length || item.attachments?.length) return false
  if (/<nova-context\s+source="/.test(item.text)) return false
  return stripHiddenMessageEnvelopes(item.text).trim() === ""
}
