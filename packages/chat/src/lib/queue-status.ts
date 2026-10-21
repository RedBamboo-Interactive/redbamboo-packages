import type { QueuedMessage } from "./message-queue"

export function maintenanceBlocksQueuedMessage(item: QueuedMessage): boolean {
  return item.remoteState === "pending" && !item.deliveryError && !item.admissionUncertain
    && (item.blockedReason === "maintenance_drain" || item.blockedReason === "maintenance")
}

export function queuedMessageStatusLabel(item: QueuedMessage, internalEvent = false): string {
  if (item.deliveryError) return item.deliveryError
  if (maintenanceBlocksQueuedMessage(item)) return "Saved, waiting for the update to finish"
  if (item.steerUnavailable) return "Sends after this turn"
  if (item.delivery === "steer-current") return "Sending into this turn"
  if (item.remoteState === "delivering") return internalEvent ? "Delivering update" : "Delivering message"
  return item.delivery === "interrupt-current" ? "Queued, interruption requested" : "Queued, sends after this turn"
}
