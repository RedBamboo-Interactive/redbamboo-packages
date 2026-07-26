import { useState, useRef, useEffect, useCallback } from "react"
import type { ImageAttachment } from "../types"
import { enqueue, cancel as cancelEntry, drainStep, shouldDrain, type QueuedMessage } from "../lib/message-queue"
import { loadQueue, saveQueue, pruneStaleQueues } from "../lib/message-queue-storage"

// Long enough to ride out a backend's isStreaming flicker around a turn
// ending. Only paid when a turn actually ran — see the idle fast path below,
// which is the common case of just sending a message to a quiet session.
const DRAIN_SETTLE_MS = 200

function getStorage(): Storage | null {
  try { return typeof localStorage !== "undefined" ? localStorage : null } catch { return null }
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
  onDrain: (text: string, images?: ImageAttachment[]) => void
}

export function useMessageQueue({ sessionId, isStreaming, disabled, resumePending = false, questionPending = false, onDrain }: UseMessageQueueOptions) {
  const [queue, setQueue] = useState<QueuedMessage[]>(() => {
    const storage = getStorage()
    return sessionId && storage ? loadQueue(storage, sessionId) : []
  })

  // A session switch must swap the queue synchronously during render (not in
  // an effect): otherwise the drain effect below can run first in the same
  // commit, see the outgoing session's leftover queue paired with the
  // incoming session's isStreaming/disabled, and hand its messages to the
  // wrong backend.
  const prevSessionRef = useRef(sessionId)
  if (prevSessionRef.current !== sessionId) {
    prevSessionRef.current = sessionId
    const storage = getStorage()
    setQueue(sessionId && storage ? loadQueue(storage, sessionId) : [])
  }

  const queueRef = useRef(queue)
  queueRef.current = queue
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
  useEffect(() => {
    if (isStreaming) sawStreamingRef.current = true
  }, [isStreaming])

  useEffect(() => {
    const storage = getStorage()
    if (storage) pruneStaleQueues(storage, Date.now())
  }, [])

  useEffect(() => {
    const storage = getStorage()
    if (!storage || !sessionId) return
    saveQueue(storage, sessionId, queue, Date.now())
  }, [queue, sessionId])

  const drain = useCallback(() => {
    // Re-check against the latest refs, not the values this closure was
    // scheduled with — the settle delay exists precisely so a flickered
    // isStreaming (or a resumePending that hasn't cleared yet) can still
    // block this from firing.
    if (!shouldDrain({
      queueLength: queueRef.current.length,
      isStreaming: isStreamingRef.current,
      disabled: disabledRef.current,
      resumePending: resumePendingRef.current,
      questionPending: questionPendingRef.current,
    })) return
    const result = drainStep(queueRef.current)
    if (!result) return
    setQueue(result.remaining)
    onDrainRef.current(result.sent.text, result.sent.images)
  }, [])

  useEffect(() => {
    if (!shouldDrain({ queueLength: queue.length, isStreaming, disabled, resumePending, questionPending })) return
    const timer = setTimeout(drain, sawStreamingRef.current ? DRAIN_SETTLE_MS : 0)
    // Any dependency change before the timer fires (queue mutated, streaming
    // flickered, disabled/resumePending/questionPending toggled) cancels it —
    // the next run of this effect decides fresh whether a new timer is warranted.
    return () => clearTimeout(timer)
  }, [queue.length, isStreaming, disabled, resumePending, questionPending, drain])

  const add = useCallback((text: string, images?: ImageAttachment[]) => {
    // Queued into a quiet session: this drain isn't waiting on anything, so it
    // skips the settle. Re-armed by the effect above if a turn starts first.
    if (!isStreamingRef.current) sawStreamingRef.current = false
    const entry: QueuedMessage = { id: `q-${Date.now()}-${Math.random().toString(36).slice(2)}`, text, images }
    setQueue(prev => enqueue(prev, entry))
  }, [])

  const cancel = useCallback((id: string) => {
    setQueue(prev => cancelEntry(prev, id))
  }, [])

  /** Removes an entry and hands it back, for pulling its text into the composer to edit. */
  const pullback = useCallback((id: string): QueuedMessage | undefined => {
    const item = queueRef.current.find(m => m.id === id)
    if (item) setQueue(prev => cancelEntry(prev, id))
    return item
  }, [])

  return { queue, add, cancel, pullback }
}
