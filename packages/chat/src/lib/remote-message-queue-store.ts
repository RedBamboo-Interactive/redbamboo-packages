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

function queuedMessage(item: ChatQueuedItem): QueuedMessage {
  return {
    id: item.id,
    clientId: item.clientId ?? undefined,
    sessionId: item.sessionId,
    text: item.displayContent,
    attachments: item.attachments,
    deliveryError: item.error?.message,
    remoteState: item.state === "delivered" || item.state === "cancelled" ? undefined : item.state,
    delivery: item.delivery,
    messageUid: item.messageUid,
  }
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
        .filter(item => item.state !== "delivered" && item.state !== "cancelled")
        .map(queuedMessage)
      entry.store.update(previous => [
        ...server,
        ...previous.filter(item => item.optimistic && !authoritative.some(serverItem =>
          serverItem.id === item.id || serverItem.clientId === item.id)),
      ])
    } while (entry.invalidated)
  })().finally(() => { entry.refresh = undefined })
  return entry.refresh
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
