import { useState, useCallback, useEffect, useRef } from "react"
import type { ChatBackend, ChatEvent, MessageBlock, ImageAttachment, PendingQuestion } from "../types"
import { processStreamEvent, finalizeStreamBlock } from "../lib/process-stream-event"

const EMPTY_MESSAGES: MessageBlock[] = []
const noop = () => {}
const noopAsync = async () => {}

export function useChatStream(backend: ChatBackend | null) {
  const [messages, setMessages] = useState<MessageBlock[]>(EMPTY_MESSAGES)
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [interrupting, setInterrupting] = useState(false)
  const [resumePending, setResumePending] = useState(false)
  const resumePendingRef = useRef(false)
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
      const result = processStreamEvent(prev, true, event, resumePendingRef.current)
      setIsStreaming(result.isStreaming)
      setPendingQuestion(result.pendingQuestion)
      setInterrupting(result.interrupting)
      resumePendingRef.current = result.resumePending
      setResumePending(result.resumePending)
      return result.messages
    })
  }, [])

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
    setPendingQuestion(null)
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
    setPendingQuestion(null)
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
    setPendingQuestion(null)
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
      interrupting: false,
      resumePending: false,
      sendMessage: noopAsync as (text: string, images?: ImageAttachment[]) => Promise<void>,
      interrupt: noop,
      reset: noopAsync,
    }
  }

  return { messages, isStreaming, pendingQuestion, interrupting, resumePending, sendMessage, interrupt, reset }
}
