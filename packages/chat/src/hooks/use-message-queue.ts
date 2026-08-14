import { useRef, useEffect, useCallback, useSyncExternalStore } from "react"
import type { ChatQueueTransport, ImageAttachment, SendOptions, UploadedAttachment } from "../types"
import { enqueue, cancel as cancelEntry, shouldDrain, type QueuedMessage } from "../lib/message-queue"
import { loadQueue, saveQueue, pruneStaleQueues } from "../lib/message-queue-storage"
import { createMessageQueueStore, type MessageQueueStore } from "../lib/message-queue-store"
import {
  connectRemoteMessageQueue,
  getRemoteMessageQueueStore,
  getRemoteMessageQueueTransport,
  refreshRemoteMessageQueue,
  settleRemoteMessageQueue,
} from "../lib/remote-message-queue-store"
import { admitWithOutbox, migrateLegacyOutbox } from "../lib/remote-message-outbox"

// Long enough to ride out a backend's isStreaming flicker around a turn
// ending. Only paid when a turn actually ran — see the idle fast path below,
// which is the common case of just sending a message to a quiet session.
const DRAIN_SETTLE_MS = 200

function getStorage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null } catch { return null }
}

const sessionStores = new Map<string, MessageQueueStore>()
function getSessionStore(sessionId: string): MessageQueueStore {
  const existing = sessionStores.get(sessionId)
  if (existing) return existing
  const storage = getStorage()
  const store = createMessageQueueStore(
    storage ? loadQueue(storage, sessionId) : [],
    queue => {
      const currentStorage = getStorage()
      if (currentStorage) saveQueue(currentStorage, sessionId, queue, Date.now())
    },
  )
  sessionStores.set(sessionId, store)
  return store
}

export interface UseMessageQueueOptions {
  sessionId?: string | null
  isStreaming: boolean
  disabled: boolean
  /**
   * True while the backend's process is being force-killed and replaced —
   * isStreaming is already false by then, but writing would race the resume.
   * See process-stream-event.ts's "killed" status handling. Defaults false
   * for backends that don't report this granularity.
   */
  resumePending?: boolean
  /**
   * The agent is blocked on a question. `isStreaming` is false in that state
   * but the turn is still open, and answers go through `onAnswerQuestion`
   * rather than the queue — so the drain has to hold.
   */
  questionPending?: boolean
  queueTransport?: ChatQueueTransport
  onDrain: (text: string, images?: ImageAttachment[], attachments?: UploadedAttachment[], options?: SendOptions) => void | Promise<unknown>
  onDiscardAttachments?: (attachments: UploadedAttachment[]) => void
}

export function useMessageQueue({ sessionId, isStreaming, disabled, resumePending = false, questionPending = false, queueTransport, onDrain, onDiscardAttachments }: UseMessageQueueOptions) {
  // Sessionless ChatPanels keep their old per-instance queue semantics. Named
  // sessions deliberately converge on the shared store so portals and other
  // simultaneous views cannot race the same persisted delivery.
  const localStoreRef = useRef<MessageQueueStore | null>(null)
  if (!localStoreRef.current) localStoreRef.current = createMessageQueueStore()
  const remote = Boolean(sessionId && queueTransport)
  const store = remote && sessionId ? getRemoteMessageQueueStore(sessionId) : sessionId ? getSessionStore(sessionId) : localStoreRef.current
  const storeSnapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const queue = storeSnapshot.queue
  const isStreamingRef = useRef(isStreaming)
  isStreamingRef.current = isStreaming
  const disabledRef = useRef(disabled)
  disabledRef.current = disabled
  const resumePendingRef = useRef(resumePending)
  resumePendingRef.current = resumePending
  const questionPendingRef = useRef(questionPending)
  questionPendingRef.current = questionPending
  const onDrainRef = useRef(onDrain)
  onDrainRef.current = onDrain
  const onDiscardAttachmentsRef = useRef(onDiscardAttachments)
  onDiscardAttachmentsRef.current = onDiscardAttachments

  useEffect(() => {
    if (!sessionId || !queueTransport) return
    return connectRemoteMessageQueue(sessionId, queueTransport)
  }, [sessionId, queueTransport])

  // The settle delay only earns its keep when the drain is waiting on a turn
  // to end, because that is the only moment isStreaming can flicker. Queueing
  // into an already-quiet session has nothing to ride out, and paying 200ms
  // there would put a visible ghost-then-real pop on every ordinary message.
  //
  // Set both ways: `add` clears it when the session was idle at enqueue time,
  // and the effect re-arms it if a turn starts before the timer fires — so a
  // race just costs the settle rather than an early write.
  //
  // Seeded from the restored queue: a cold mount hasn't heard the session's
  // status yet, so a queue rehydrated from localStorage takes the settle
  // instead of firing blind into what might be a turn already in progress.
  const sawStreamingRef = useRef(queue.length > 0)
  const sawStreamingSessionRef = useRef(sessionId)
  if (sawStreamingSessionRef.current !== sessionId) {
    sawStreamingSessionRef.current = sessionId
    sawStreamingRef.current = queue.length > 0
  }
  useEffect(() => {
    if (isStreaming) sawStreamingRef.current = true
  }, [isStreaming])

  useEffect(() => {
    const storage = getStorage()
    if (storage) pruneStaleQueues(storage, Date.now())
  }, [])

  // One-release migration: localStorage is an unacknowledged outbox only.
  // Remove each item after RedCompute has accepted the same idempotency key.
  useEffect(() => {
    if (!remote || !sessionId) return
    const storage = getStorage()
    if (!storage) return
    void migrateLegacyOutbox(storage, sessionId, item =>
      onDrainRef.current(item.text, item.images, item.attachments, {
        delivery: "after-current",
        idempotencyKey: item.id,
        displayContent: item.text,
      }),
      () => refreshRemoteMessageQueue(sessionId),
    ).catch(() => {})
  }, [remote, sessionId])

  const drain = useCallback(() => {
    if (remote) return
    // Re-check against the latest refs, not the values this closure was
    // scheduled with — the settle delay exists precisely so a flickered
    // isStreaming (or a resumePending that hasn't cleared yet) can still
    // block this from firing.
    if (!shouldDrain({
      queueLength: store.getSnapshot().queue.some(message => message.deliveryError) ? 0 : store.getSnapshot().queue.length,
      isStreaming: isStreamingRef.current,
      disabled: disabledRef.current,
      resumePending: resumePendingRef.current,
      questionPending: questionPendingRef.current,
    })) return
    const claim = store.claimDrain()
    if (!claim) return
    let delivery: void | Promise<unknown>
    try {
      delivery = onDrainRef.current(claim.sent.text, claim.sent.images, claim.sent.attachments)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Message delivery failed"
      claim.fail(message)
      return
    }
    Promise.resolve(delivery).then(() => {
      claim.complete()
    }).catch(error => {
      const message = error instanceof Error ? error.message : "Message delivery failed"
      claim.fail(message)
    })
  }, [store, remote])

  const hasDeliveryError = queue.some(message => message.deliveryError)
  useEffect(() => {
    if (remote) return
    const queueLength = hasDeliveryError ? 0 : queue.length
    if (!shouldDrain({ queueLength, isStreaming, disabled, resumePending, questionPending })) return
    const timer = setTimeout(drain, sawStreamingRef.current ? DRAIN_SETTLE_MS : 0)
    // Any dependency change before the timer fires (queue mutated, streaming
    // flickered, disabled/resumePending/questionPending toggled) cancels it —
    // the next run of this effect decides fresh whether a new timer is warranted.
    return () => clearTimeout(timer)
  }, [queue.length, hasDeliveryError, isStreaming, disabled, resumePending, questionPending, drain, storeSnapshot.revision, remote])

  const submitRemote = useCallback((entry: QueuedMessage, options?: SendOptions) => {
    if (!sessionId) return
    store.update(previous => enqueue(previous.filter(item => item.id !== entry.id), { ...entry, optimistic: true }))
    const storage = getStorage()
    void admitWithOutbox(storage, sessionId, entry, () =>
      onDrainRef.current(entry.text, entry.images, entry.attachments, {
        ...options,
        delivery: options?.delivery ?? "after-current",
        idempotencyKey: entry.id,
        displayContent: entry.text,
      }),
    ).then(async admission => {
      const result = admission as {
        disposition?: "queued" | "delivered"
        queueItemId?: string | null
        messageUid?: string | null
        item?: { id?: string; messageUid?: string; deliveredMessageUid?: string | null; state?: QueuedMessage["remoteState"] } | null
      } | null
      store.update(previous => previous.map(item => item.id !== entry.id ? item : {
        ...item,
        remoteId: result?.item?.id ?? result?.queueItemId ?? item.remoteId,
        messageUid: result?.item?.messageUid ?? result?.messageUid ?? item.messageUid,
        deliveredMessageUid: result?.item?.deliveredMessageUid ?? undefined,
        remoteState: result?.disposition === "delivered" ? "delivered" : result?.item?.state ?? item.remoteState,
        appearance: result?.disposition === "delivered" ? "message" : item.appearance,
        optimistic: false,
      }))
      await refreshRemoteMessageQueue(sessionId)
    }).catch(async error => {
      try {
        await refreshRemoteMessageQueue(sessionId)
        if (!store.getSnapshot().queue.some(item => item.id === entry.id && item.optimistic)) return
      } catch { /* keep the outbox ghost until admission can be verified */ }
      const message = error instanceof Error ? error.message : "Message admission failed"
      const definitive = typeof (error as { status?: unknown } | null)?.status === "number"
      const failed = {
        ...entry,
        appearance: "queue" as const,
        optimistic: true,
        admissionUncertain: !definitive,
        deliveryError: definitive ? message : `Admission unconfirmed: ${message}`,
      }
      store.update(previous => [...previous.filter(item => item.id !== entry.id), failed])
      const storage = getStorage()
      if (storage) saveQueue(storage, sessionId, [...loadQueue(storage, sessionId).filter(item => item.id !== entry.id), failed], Date.now())
    })
  }, [sessionId, store])

  const add = useCallback((text: string, images?: ImageAttachment[], options?: SendOptions) => {
    // Queued into a quiet session: this drain isn't waiting on anything, so it
    // skips the settle. Re-armed by the effect above if a turn starts first.
    if (!isStreamingRef.current) sawStreamingRef.current = false
    const entry: QueuedMessage = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sessionId: sessionId ?? undefined,
      text,
      images,
      appearance: isStreamingRef.current ? "queue" : "message",
    }
    if (remote) { submitRemote(entry, options); return }
    store.update(previous => enqueue(previous, entry))
  }, [store, remote, submitRemote, sessionId])

  const addInput = useCallback((text: string, attachments: UploadedAttachment[], images?: ImageAttachment[], options?: SendOptions) => {
    if (!isStreamingRef.current) sawStreamingRef.current = false
    const entry: QueuedMessage = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      sessionId: sessionId ?? undefined,
      text,
      images,
      attachments,
      appearance: isStreamingRef.current ? "queue" : "message",
    }
    if (remote) { submitRemote(entry, options); return }
    store.update(previous => enqueue(previous, entry))
  }, [store, remote, submitRemote, sessionId])

  const cancel = useCallback((id: string) => {
    const item = store.getSnapshot().queue.find(message => message.id === id)
    if (remote && sessionId) {
      if (!item?.optimistic) {
        const transport = getRemoteMessageQueueTransport(sessionId)
        if (transport) void transport.cancel(item?.remoteId ?? id).then(() => refreshRemoteMessageQueue(sessionId)).catch(() => refreshRemoteMessageQueue(sessionId))
      }
      const storage = getStorage()
      if (storage) saveQueue(storage, sessionId, loadQueue(storage, sessionId).filter(message => message.id !== id), Date.now())
    }
    if (item?.attachments?.length) onDiscardAttachmentsRef.current?.(item.attachments)
    store.update(previous => cancelEntry(previous, id))
  }, [store, remote, sessionId])

  /** Removes an entry and hands it back, for pulling its text into the composer to edit. */
  const pullback = useCallback((id: string): QueuedMessage | undefined => {
    const item = store.getSnapshot().queue.find(message => message.id === id)
    if (item) {
      if (remote && sessionId && !item.optimistic) {
        const transport = getRemoteMessageQueueTransport(sessionId)
        if (transport) void transport.cancel(item.remoteId ?? id).catch(() => refreshRemoteMessageQueue(sessionId))
      }
      store.update(previous => cancelEntry(previous, id))
    }
    return item
  }, [store, remote, sessionId])

  const retry = useCallback((id: string) => {
    if (remote && sessionId) {
      const item = store.getSnapshot().queue.find(message => message.id === id)
      if (item?.optimistic) {
        submitRemote({ ...item, deliveryError: undefined }, { delivery: item.delivery ?? "after-current" })
        return
      }
      const transport = getRemoteMessageQueueTransport(sessionId)
      if (transport) void transport.retry(item?.remoteId ?? id).then(() => refreshRemoteMessageQueue(sessionId)).catch(() => refreshRemoteMessageQueue(sessionId))
      return
    }
    store.update(previous => previous.map(message => message.id === id ? { ...message, deliveryError: undefined } : message))
  }, [store, remote, sessionId, submitRemote])

  const sendNow = useCallback(() => {
    if (!remote || !sessionId) return false
    const transport = getRemoteMessageQueueTransport(sessionId)
    if (!transport) return false
    void transport.sendNow().then(() => refreshRemoteMessageQueue(sessionId)).catch(() => refreshRemoteMessageQueue(sessionId))
    return true
  }, [remote, sessionId])

  const settleDelivered = useCallback((messageUids: Iterable<string>) => {
    if (remote && sessionId) settleRemoteMessageQueue(sessionId, messageUids)
  }, [remote, sessionId])

  return { queue, add, addInput, cancel, pullback, retry, sendNow, settleDelivered, remote }
}
