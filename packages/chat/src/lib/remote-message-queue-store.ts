import type { ChatQueueTransport, ChatQueuedItem } from "../types.ts"
import type { QueuedMessage } from "./message-queue.ts"
import { createMessageQueueStore, type MessageQueueStore } from "./message-queue-store.ts"

interface RemoteQueueEntry {
  store: MessageQueueStore
  transport?: ChatQueueTransport
  subscriptions: Set<() => void>
  refresh?: Promise<void>
  invalidated?: boolean
}

const remoteQueues = new Map<string, RemoteQueueEntry>()

function sameMessage(left: QueuedMessage, right: QueuedMessage): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function queuedMessage(item: ChatQueuedItem, previous?: QueuedMessage): QueuedMessage {
  const deliveredAt = item.completedAt ?? (item.state === "delivered" ? item.updatedAt : undefined)
  return {
    id: item.clientId ?? previous?.id ?? item.id,
    remoteId: item.id,
    clientId: item.clientId ?? undefined,
    sessionId: item.sessionId,
    text: item.displayContent,
    attachments: item.attachments,
    deliveryError: item.error?.message,
    remoteState: item.state === "cancelled" ? undefined : item.state,
    appearance: item.state === "delivered" ? "message" : previous?.appearance ?? "queue",
    delivery: item.delivery,
    messageUid: item.messageUid,
    deliveredMessageUid: item.deliveredMessageUid ?? undefined,
    createdAt: item.createdAt,
    deliveredAt,
    timelineAt: previous?.timelineAt ?? (item.state === "delivered" ? deliveredAt : undefined),
  }
}

function matches(item: ChatQueuedItem, message: QueuedMessage): boolean {
  return item.id === message.remoteId
    || item.id === message.id
    || (!!item.clientId && (item.clientId === message.id || item.clientId === message.clientId))
}

export function getRemoteMessageQueueStore(sessionId: string): MessageQueueStore {
  let entry = remoteQueues.get(sessionId)
  if (!entry) {
    entry = { store: createMessageQueueStore(), subscriptions: new Set() }
    remoteQueues.set(sessionId, entry)
  }
  return entry.store
}

export function connectRemoteMessageQueue(sessionId: string, transport: ChatQueueTransport): () => void {
  const entry = remoteQueues.get(sessionId) ?? { store: createMessageQueueStore(), subscriptions: new Set<() => void>() }
  remoteQueues.set(sessionId, entry)
  entry.transport = transport
  const unsubscribe = transport.subscribe?.(() => { void refreshRemoteMessageQueue(sessionId) })
  if (unsubscribe) entry.subscriptions.add(unsubscribe)
  void refreshRemoteMessageQueue(sessionId)
  return () => {
    unsubscribe?.()
    if (unsubscribe) entry.subscriptions.delete(unsubscribe)
  }
}

export async function refreshRemoteMessageQueue(sessionId: string): Promise<void> {
  const entry = remoteQueues.get(sessionId)
  if (!entry?.transport) return
  if (entry.refresh) {
    entry.invalidated = true
    return entry.refresh
  }
  entry.refresh = (async () => {
    do {
      entry.invalidated = false
      const snapshot = await entry.transport!.list()
      const authoritative = snapshot.items
      const server = authoritative
        .map(item => ({ item, previous: entry.store.getSnapshot().queue.find(message => matches(item, message)) }))
        // Delivered receipts remain only when they bridge a bubble already visible in this client.
        // Other clients converge through their transcript without manufacturing old outgoing UI.
        .filter(({ item, previous }) => item.state !== "cancelled" && (item.state !== "delivered" || previous))
        .map(({ item, previous }) => queuedMessage(item, previous))
      entry.store.update(previous => {
        const next = [
          ...server,
          ...previous.filter(message => message.optimistic && !authoritative.some(item => matches(item, message))),
        ]
        if (next.length === previous.length && next.every((message, index) => sameMessage(message, previous[index]!)))
          return previous
        return next
      })
    } while (entry.invalidated)
  })().finally(() => { entry.refresh = undefined })
  return entry.refresh
}

/** Remove delivered presentation bridges once their canonical transcript blocks are mounted. */
export function settleRemoteMessageQueue(sessionId: string, deliveredMessageUids: Iterable<string>): void {
  const entry = remoteQueues.get(sessionId)
  if (!entry) return
  const settled = new Set(deliveredMessageUids)
  if (settled.size === 0) return
  entry.store.update(previous => previous.filter(message =>
    message.remoteState !== "delivered"
    || !settled.has(message.deliveredMessageUid ?? message.messageUid ?? "")))
}

/** Test-only isolation for module-scoped cross-view state. */
export function resetRemoteMessageQueueStores(): void {
  for (const entry of remoteQueues.values())
    for (const unsubscribe of entry.subscriptions) unsubscribe()
  remoteQueues.clear()
}

export function getRemoteMessageQueueTransport(sessionId: string): ChatQueueTransport | undefined {
  return remoteQueues.get(sessionId)?.transport
}
