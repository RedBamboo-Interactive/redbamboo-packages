import { useState, useCallback, useEffect, useRef } from "react"
import type { ChatBackend, ChatEvent, MessageBlock, ImageAttachment, PendingQuestion, QuestionAnswerPayload, QuestionOutcome, QuestionState } from "../types"
import { processStreamEvent, finalizeStreamBlock } from "../lib/process-stream-event"

const EMPTY_MESSAGES: MessageBlock[] = []
const NO_QUESTION: QuestionState = { pending: null, outcome: null }
const noop = () => {}
const noopAsync = async () => {}

export function useChatStream(backend: ChatBackend | null) {
  const [messages, setMessages] = useState<MessageBlock[]>(EMPTY_MESSAGES)
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [questionOutcome, setQuestionOutcome] = useState<QuestionOutcome | null>(null)
  const [interrupting, setInterrupting] = useState(false)
  const [resumePending, setResumePending] = useState(false)
  const resumePendingRef = useRef(false)
  // processStreamEvent is pure: the question lifecycle has to be threaded back
  // in on every event, and a ref (not state) so it's current inside the updater.
  const questionRef = useRef<QuestionState>(NO_QUESTION)
  const unsubRef = useRef<(() => void) | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!backend?.getHistory) return
    backend.getHistory().then(history => {
      if (history?.length) setMessages(history)
    }).catch(() => {})
  }, [backend])

  const processEvent = useCallback((event: ChatEvent) => {
    setMessages(prev => {
      const result = processStreamEvent(prev, true, event, resumePendingRef.current, questionRef.current)
      setIsStreaming(result.isStreaming)
      questionRef.current = result.question
      setPendingQuestion(result.question.pending)
      setQuestionOutcome(result.question.outcome)
      setInterrupting(result.interrupting)
      resumePendingRef.current = result.resumePending
      setResumePending(result.resumePending)
      return result.messages
    })
  }, [])

  const answerQuestion = useCallback(async (answer: string, payload?: QuestionAnswerPayload) => {
    const pending = questionRef.current.pending
    const sessionId = sessionIdRef.current
    // Optimistic: the card resolves now rather than waiting for the round trip.
    // A backend that can't take structured answers gets the readable form as a
    // normal turn instead — that was the only channel before this existed.
    questionRef.current = { pending: null, outcome: "answered" }
    setPendingQuestion(null)
    setQuestionOutcome("answered")

    const body: QuestionAnswerPayload = { ...(payload ?? { response: answer }) }
    if (pending?.requestId && !body.requestId) body.requestId = pending.requestId

    try {
      if (sessionId && backend?.answerQuestion && body.requestId) {
        await backend.answerQuestion(sessionId, body)
      } else if (backend) {
        setIsStreaming(true)
        await backend.sendMessage(answer)
      }
    } catch {
      setIsStreaming(false)
    }
  }, [backend])

  const sendMessage = useCallback(async (text: string, images?: ImageAttachment[]) => {
    if (!backend) return
    const userBlock: MessageBlock = {
      id: `user-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", content: text, images }],
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userBlock])
    setIsStreaming(true)
    questionRef.current = NO_QUESTION
    setPendingQuestion(null)
    setQuestionOutcome(null)
    setInterrupting(false)
    resumePendingRef.current = false
    setResumePending(false)

    try {
      const { sessionId } = await backend.sendMessage(text, images)
      sessionIdRef.current = sessionId

      if (unsubRef.current) unsubRef.current()
      unsubRef.current = backend.subscribe(sessionId, processEvent)
    } catch {
      setIsStreaming(false)
    }
  }, [backend, processEvent])

  // This is a hard, local stop — not a wait for the backend's own
  // interrupting/killed/idle vocabulary. A generic ChatBackend has no
  // obligation to emit that granularity, so unlike the richer consumer-owned
  // hooks (CodeRed/Nova), this generic path can't safely wait for confirmation
  // without risking getting stuck if a backend never sends one.
  const interrupt = useCallback(() => {
    setIsStreaming(false)
    questionRef.current = { pending: null, outcome: questionRef.current.pending ? "cancelled" : questionRef.current.outcome }
    setPendingQuestion(null)
    setQuestionOutcome(questionRef.current.outcome)
    setInterrupting(false)
    resumePendingRef.current = false
    setResumePending(false)

    setMessages(prev => finalizeStreamBlock(prev))

    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }

    if (sessionIdRef.current && backend?.interrupt) {
      backend.interrupt(sessionIdRef.current).catch(() => {})
    }
  }, [backend])

  const reset = useCallback(async () => {
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }
    await backend?.reset?.()
    setMessages(EMPTY_MESSAGES)
    setIsStreaming(false)
    questionRef.current = NO_QUESTION
    setPendingQuestion(null)
    setQuestionOutcome(null)
    setInterrupting(false)
    resumePendingRef.current = false
    setResumePending(false)
    sessionIdRef.current = null
  }, [backend])

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current()
    }
  }, [])

  if (!backend) {
    return {
      messages: EMPTY_MESSAGES,
      isStreaming: false,
      pendingQuestion: null as PendingQuestion | null,
      questionOutcome: null as QuestionOutcome | null,
      interrupting: false,
      resumePending: false,
      sendMessage: noopAsync as (text: string, images?: ImageAttachment[]) => Promise<void>,
      interrupt: noop,
      reset: noopAsync,
      answerQuestion: noopAsync as (answer: string, payload?: QuestionAnswerPayload) => Promise<void>,
    }
  }

  return { messages, isStreaming, pendingQuestion, questionOutcome, interrupting, resumePending, sendMessage, interrupt, reset, answerQuestion }
}
