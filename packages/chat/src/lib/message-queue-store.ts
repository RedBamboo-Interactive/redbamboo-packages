import { drainStep, type QueuedMessage } from "./message-queue.ts"

export interface MessageQueueStoreSnapshot {
  queue: QueuedMessage[]
  draining: boolean
  revision: number
}

export interface MessageQueueDrainClaim {
  sent: NonNullable<ReturnType<typeof drainStep>>["sent"]
  complete(): void
  fail(message: string): void
}

export interface MessageQueueStore {
  getSnapshot(): MessageQueueStoreSnapshot
  subscribe(listener: () => void): () => void
  update(updater: (queue: QueuedMessage[]) => QueuedMessage[]): void
  claimDrain(): MessageQueueDrainClaim | null
}

/**
 * One queue and one atomic drain lease for every mounted view of a session.
 * The optional persistence callback is invoked only when queue contents change,
 * never for the transient drain lease.
 */
export function createMessageQueueStore(
  initialQueue: QueuedMessage[] = [],
  persist?: (queue: QueuedMessage[]) => void,
): MessageQueueStore {
  let snapshot: MessageQueueStoreSnapshot = { queue: initialQueue, draining: false, revision: 0 }
  const listeners = new Set<() => void>()

  const publish = (queue: QueuedMessage[], draining: boolean, persistQueue: boolean) => {
    snapshot = { queue, draining, revision: snapshot.revision + 1 }
    if (persistQueue) persist?.(queue)
    for (const listener of listeners) listener()
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    update(updater) {
      const next = updater(snapshot.queue)
      if (next === snapshot.queue) return
      publish(next, snapshot.draining, true)
    },
    claimDrain() {
      if (snapshot.draining) return null
      const result = drainStep(snapshot.queue)
      if (!result) return null

      let settled = false
      publish(result.remaining, true, true)

      const settle = (recovered?: QueuedMessage) => {
        if (settled) return
        settled = true
        const queue = recovered ? [recovered, ...snapshot.queue] : snapshot.queue
        publish(queue, false, Boolean(recovered))
      }

      return {
        sent: result.sent,
        complete: () => settle(),
        fail(message: string) {
          settle({
            id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            ...result.sent,
            deliveryError: message,
          })
        },
      }
    },
  }
}
