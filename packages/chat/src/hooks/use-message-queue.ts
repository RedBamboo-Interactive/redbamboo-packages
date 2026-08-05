import { useRef, useEffect, useCallback, useSyncExternalStore } from "react"
import type { ImageAttachment, UploadedAttachment } from "../types"
import { enqueue, cancel as cancelEntry, shouldDrain, type QueuedMessage } from "../lib/message-queue"
import { loadQueue, saveQueue, pruneStaleQueues } from "../lib/message-queue-storage"
import { createMessageQueueStore, type MessageQueueStore } from "../lib/message-queue-store"

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
  onDrain: (text: string, images?: ImageAttachment[], attachments?: UploadedAttachment[]) => void | Promise<void>
  onDiscardAttachments?: (attachments: UploadedAttachment[]) => void
}

export function useMessageQueue({ sessionId, isStreaming, disabled, resumePending = false, questionPending = false, onDrain, onDiscardAttachments }: UseMessageQueueOptions) {
  // Sessionless ChatPanels keep their old per-instance queue semantics. Named
  // sessions deliberately converge on the shared store so portals and other
  // simultaneous views cannot race the same persisted delivery.
  const localStoreRef = useRef<MessageQueueStore | null>(null)
  if (!localStoreRef.current) localStoreRef.current = createMessageQueueStore()
  const store = sessionId ? getSessionStore(sessionId) : localStoreRef.current
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

  const drain = useCallback(() => {
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
    let delivery: void | Promise<void>
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
  }, [store])

  const hasDeliveryError = queue.some(message => message.deliveryError)
  useEffect(() => {
    const queueLength = hasDeliveryError ? 0 : queue.length
    if (!shouldDrain({ queueLength, isStreaming, disabled, resumePending, questionPending })) return
    const timer = setTimeout(drain, sawStreamingRef.current ? DRAIN_SETTLE_MS : 0)
    // Any dependency change before the timer fires (queue mutated, streaming
    // flickered, disabled/resumePending/questionPending toggled) cancels it —
    // the next run of this effect decides fresh whether a new timer is warranted.
    return () => clearTimeout(timer)
  }, [queue.length, hasDeliveryError, isStreaming, disabled, resumePending, questionPending, drain, storeSnapshot.revision])

  const add = useCallback((text: string, images?: ImageAttachment[]) => {
    // Queued into a quiet session: this drain isn't waiting on anything, so it
    // skips the settle. Re-armed by the effect above if a turn starts first.
    if (!isStreamingRef.current) sawStreamingRef.current = false
    const entry: QueuedMessage = { id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`, text, images }
    store.update(previous => enqueue(previous, entry))
  }, [store])

  const addInput = useCallback((text: string, attachments: UploadedAttachment[]) => {
    if (!isStreamingRef.current) sawStreamingRef.current = false
    const entry: QueuedMessage = { id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`, text, attachments }
    store.update(previous => enqueue(previous, entry))
  }, [store])

  const cancel = useCallback((id: string) => {
    const item = store.getSnapshot().queue.find(message => message.id === id)
    if (item?.attachments?.length) onDiscardAttachmentsRef.current?.(item.attachments)
    store.update(previous => cancelEntry(previous, id))
  }, [store])

  /** Removes an entry and hands it back, for pulling its text into the composer to edit. */
  const pullback = useCallback((id: string): QueuedMessage | undefined => {
    const item = store.getSnapshot().queue.find(message => message.id === id)
    if (item) store.update(previous => cancelEntry(previous, id))
    return item
  }, [store])

  const retry = useCallback((id: string) => {
    store.update(previous => previous.map(message => message.id === id ? { ...message, deliveryError: undefined } : message))
  }, [store])

  return { queue, add, addInput, cancel, pullback, retry }
}
