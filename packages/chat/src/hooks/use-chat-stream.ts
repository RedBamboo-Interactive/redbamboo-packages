import { useState, useCallback, useEffect, useRef } from "react"
import type { ChatBackend, ChatEvent, MessageBlock, ImageAttachment, PendingQuestion } from "../types"
import { processStreamEvent } from "../lib/process-stream-event"

const EMPTY_MESSAGES: MessageBlock[] = []
const noop = () => {}
const noopAsync = async () => {}

export function useChatStream(backend: ChatBackend | null) {
  const [messages, setMessages] = useState<MessageBlock[]>(EMPTY_MESSAGES)
  const [isStreaming, setIsStreaming] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
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
      const result = processStreamEvent(prev, true, event)
      setIsStreaming(result.isStreaming)
      setPendingQuestion(result.pendingQuestion)
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

    try {
      const { sessionId } = await backend.sendMessage(text, images)
      sessionIdRef.current = sessionId

      if (unsubRef.current) unsubRef.current()
      unsubRef.current = backend.subscribe(sessionId, processEvent)
    } catch {
      setIsStreaming(false)
    }
  }, [backend, processEvent])

  const interrupt = useCallback(() => {
    setIsStreaming(false)
    setPendingQuestion(null)

    setMessages(prev => {
      if (!prev.length) return prev
      const lastBlock = prev[prev.length - 1]
      if (lastBlock.role !== "assistant") return prev
      const hasPartial = lastBlock.parts.some(p => p.isPartial)
      if (!hasPartial) return prev
      const updatedParts = lastBlock.parts.map(p => p.isPartial ? { ...p, isPartial: false } : p)
      return [...prev.slice(0, -1), { ...lastBlock, parts: updatedParts }]
    })

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
      sendMessage: noopAsync as (text: string, images?: ImageAttachment[]) => Promise<void>,
      interrupt: noop,
      reset: noopAsync,
    }
  }

  return { messages, isStreaming, pendingQuestion, sendMessage, interrupt, reset }
}
