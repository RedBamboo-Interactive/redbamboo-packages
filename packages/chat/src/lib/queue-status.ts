import type { QueuedMessage } from "./message-queue"

export function maintenanceBlocksQueuedMessage(item: QueuedMessage): boolean {
  return item.remoteState === "pending" && !item.deliveryError && !item.admissionUncertain
    && (item.blockedReason === "maintenance_drain" || item.blockedReason === "maintenance")
}

export function queuedMessageStatusLabel(item: QueuedMessage, internalEvent = false): string {
  if (item.deliveryError) return item.deliveryError
  if (item.remoteState === "delivering") return internalEvent ? "Delivering update" : "Delivering message"
  if (maintenanceBlocksQueuedMessage(item)) return "Saved, waiting for the update to finish"
  return item.delivery === "interrupt-current" ? "Queued, interruption requested" : "Queued, sends after this turn"
}
