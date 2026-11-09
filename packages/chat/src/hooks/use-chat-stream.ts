import { useState, useCallback, useEffect, useRef } from "react"
import type { ChatBackend, ChatEvent, ChatInputPart, MessageBlock, ImageAttachment, PendingQuestion, PermissionApprovals, PermissionDecisionPayload, QuestionAnswerPayload, QuestionOutcome, QuestionState, UploadedAttachment } from "../types"
import { processStreamEvent, finalizeStreamBlock } from "../lib/process-stream-event"
import { abandonPermissions, closePermission, isPermissionQuestion, reparkOnOpenApproval } from "../lib/permission-approval"

const EMPTY_MESSAGES: MessageBlock[] = []
const NO_QUESTION: QuestionState = { pending: null, outcome: null }

/** Nothing pending; earlier approval cards keep saying how they ended. */
function keepApprovals(state: QuestionState): QuestionState {
  const permissions = abandonPermissions(state).permissions
  return permissions ? { pending: null, outcome: null, permissions } : NO_QUESTION
}
const noop = () => {}
const noopAsync = async () => {}

export function useChatStream(backend: ChatBackend | null) {
  const [messages, setMessages] = useState<MessageBlock[]>(EMPTY_MESSAGES)
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [questionOutcome, setQuestionOutcome] = useState<QuestionOutcome | null>(null)
  const [permissionApprovals, setPermissionApprovals] = useState<PermissionApprovals | null>(null)
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
      setPermissionApprovals(result.question.permissions ?? null)
      setInterrupting(result.interrupting)
      resumePendingRef.current = result.resumePending
      setResumePending(result.resumePending)
      return result.messages
    })
  }, [])

  const answerQuestion = useCallback(async (answer: string, payload?: QuestionAnswerPayload) => {
    const pending = questionRef.current.pending
    // An approval is decided with its buttons, never with typed text.
    if (isPermissionQuestion(pending)) return
    const sessionId = sessionIdRef.current
    // Optimistic: the card resolves now rather than waiting for the round trip.
    // A backend that can't take structured answers gets the readable form as a
    // normal turn instead — that was the only channel before this existed.
    const permissions = questionRef.current.permissions
    // An approval opened under the question keeps the turn parked.
    questionRef.current = permissions
      ? reparkOnOpenApproval({ pending: null, outcome: "answered", permissions })
      : { pending: null, outcome: "answered" }
    setPendingQuestion(questionRef.current.pending)
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

  // Not optimistic: the card says "Sending" until the server takes it, and a
  // refusal rejects so the card can show it and keep its buttons.
  const decidePermission = useCallback(async ({ requestId, toolUseId, decision }: PermissionDecisionPayload) => {
    const sessionId = sessionIdRef.current
    if (!sessionId || !backend?.answerQuestion || !requestId)
      throw new Error("This chat can't answer approvals")
    await backend.answerQuestion(sessionId, { requestId, decision })
    const key = toolUseId && questionRef.current.permissions?.[toolUseId] ? toolUseId
      : Object.values(questionRef.current.permissions ?? {}).find(approval => approval.requestId === requestId)?.key
    if (!key) return
    // A backend that never sends question_resolved still settles the card;
    // one that does overrides this with its own word.
    const next = closePermission(questionRef.current, key, decision)
    questionRef.current = next
    setPendingQuestion(next.pending)
    setPermissionApprovals(next.permissions ?? null)
    if (!next.pending) setIsStreaming(true)
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
    questionRef.current = keepApprovals(questionRef.current)
    setPermissionApprovals(questionRef.current.permissions ?? null)
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
    } catch (error) {
      setMessages(previous => previous.filter(message => message.id !== userBlock.id))
      setIsStreaming(false)
      throw error
    }
  }, [backend, processEvent])

  const sendInput = useCallback(async (input: ChatInputPart[], attachments: UploadedAttachment[]) => {
    if (!backend) return
    if (!backend.sendInput) throw new Error("This chat backend does not support file attachments")
    const text = input
      .filter((part): part is Extract<ChatInputPart, { type: "text" }> => part.type === "text")
      .map(part => part.text)
      .join("\n")
    const userBlock: MessageBlock = {
      id: `user-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", content: text, attachments }],
      timestamp: new Date().toISOString(),
    }
    setMessages(previous => [...previous, userBlock])
    setIsStreaming(true)
    questionRef.current = keepApprovals(questionRef.current)
    setPermissionApprovals(questionRef.current.permissions ?? null)
    setPendingQuestion(null)
    setQuestionOutcome(null)
    setInterrupting(false)
    resumePendingRef.current = false
    setResumePending(false)

    try {
      const { sessionId } = await backend.sendInput(input, attachments)
      sessionIdRef.current = sessionId
      unsubRef.current?.()
      unsubRef.current = backend.subscribe(sessionId, processEvent)
    } catch (error) {
      setMessages(previous => previous.filter(message => message.id !== userBlock.id))
      setIsStreaming(false)
      throw error
    }
  }, [backend, processEvent])

  // This is a hard, local stop — not a wait for the backend's own
  // interrupting/killed/idle vocabulary. A generic ChatBackend has no
  // obligation to emit that granularity, so unlike the richer consumer-owned
  // hooks (CodeRed/Nova), this generic path can't safely wait for confirmation
  // without risking getting stuck if a backend never sends one.
  const interrupt = useCallback(() => {
    setIsStreaming(false)
    // Interrupting under an approval says nothing about the last question's outcome.
    const { pending, outcome } = questionRef.current
    questionRef.current = { ...keepApprovals(questionRef.current), outcome: pending && !isPermissionQuestion(pending) ? "cancelled" : outcome }
    setPermissionApprovals(questionRef.current.permissions ?? null)
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
    setPermissionApprovals(null)
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
      permissionApprovals: null as PermissionApprovals | null,
      interrupting: false,
      resumePending: false,
      sendMessage: noopAsync as (text: string, images?: ImageAttachment[]) => Promise<void>,
      sendInput: noopAsync as (input: ChatInputPart[], attachments: UploadedAttachment[]) => Promise<void>,
      interrupt: noop,
      reset: noopAsync,
      answerQuestion: noopAsync as (answer: string, payload?: QuestionAnswerPayload) => Promise<void>,
      decidePermission: noopAsync as (payload: PermissionDecisionPayload) => Promise<void>,
    }
  }

  return { messages, isStreaming, pendingQuestion, questionOutcome, permissionApprovals, interrupting, resumePending, sendMessage, sendInput, interrupt, reset, answerQuestion, decidePermission }
}
