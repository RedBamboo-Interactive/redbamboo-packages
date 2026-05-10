import { useState, useCallback, useEffect, useRef } from "react"
import type { ChatBackend, ChatEvent, MessageBlock, MessagePart, ImageAttachment } from "../types"

let partIdCounter = 0

export function useChatStream(backend: ChatBackend) {
  const [messages, setMessages] = useState<MessageBlock[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const unsubRef = useRef<(() => void) | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!backend.getHistory) return
    backend.getHistory().then(history => {
      if (history?.length) setMessages(history)
    }).catch(() => {})
  }, [backend])

  const processEvent = useCallback((event: ChatEvent) => {
    if (event.type === "status") {
      setIsStreaming(false)
      setMessages(prev => {
        if (!prev.length) return prev
        const lastBlock = prev[prev.length - 1]
        if (lastBlock.role !== "assistant") return prev
        const hasPartial = lastBlock.parts.some(p => p.isPartial)
        if (!hasPartial) return prev
        const updatedParts = lastBlock.parts.map(p => p.isPartial ? { ...p, isPartial: false } : p)
        return [...prev.slice(0, -1), { ...lastBlock, parts: updatedParts }]
      })
      return
    }

    if (event.type === "error") {
      setIsStreaming(false)
    }

    setMessages(prev => {
      const msgs = [...prev]
      let lastBlock = msgs[msgs.length - 1]

      if (!lastBlock || lastBlock.role !== "assistant") {
        lastBlock = {
          id: `assistant-${Date.now()}-${partIdCounter++}`,
          role: "assistant",
          parts: [],
          timestamp: new Date().toISOString(),
        }
        msgs.push(lastBlock)
      } else {
        lastBlock = { ...lastBlock, parts: [...lastBlock.parts] }
        msgs[msgs.length - 1] = lastBlock
      }

      const part: MessagePart = {
        type: event.type as MessagePart["type"],
        content: event.content || event.toolResult || "",
        toolName: event.toolName || undefined,
        toolInput: event.toolInput || undefined,
      }

      if (event.type === "text" && lastBlock.parts.length > 0) {
        const lastPart = lastBlock.parts[lastBlock.parts.length - 1]
        if (lastPart.type === "text") {
          lastBlock.parts[lastBlock.parts.length - 1] = {
            ...lastPart,
            content: lastPart.content + (event.content || ""),
          }
          return msgs
        }
      }

      if (event.type === "thinking" && lastBlock.parts.length > 0) {
        const lastPart = lastBlock.parts[lastBlock.parts.length - 1]
        if (lastPart.type === "thinking" && lastPart.isPartial) {
          lastBlock.parts[lastBlock.parts.length - 1] = {
            ...lastPart,
            content: lastPart.content + (event.content || ""),
          }
          return msgs
        }
      }

      if (lastBlock.parts.length > 0) {
        const lastPart = lastBlock.parts[lastBlock.parts.length - 1]
        if (lastPart.isPartial) {
          lastBlock.parts[lastBlock.parts.length - 1] = { ...lastPart, isPartial: false }
        }
      }

      lastBlock.parts.push({ ...part, isPartial: true })
      return msgs
    })
  }, [])

  const sendMessage = useCallback(async (text: string, images?: ImageAttachment[]) => {
    const userBlock: MessageBlock = {
      id: `user-${Date.now()}`,
      role: "user",
      parts: [{ type: "text", content: text, images }],
      timestamp: new Date().toISOString(),
    }
    setMessages(prev => [...prev, userBlock])
    setIsStreaming(true)

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

    if (sessionIdRef.current && backend.interrupt) {
      backend.interrupt(sessionIdRef.current).catch(() => {})
    }
  }, [backend])

  const reset = useCallback(async () => {
    if (unsubRef.current) {
      unsubRef.current()
      unsubRef.current = null
    }
    await backend.reset?.()
    setMessages([])
    setIsStreaming(false)
    sessionIdRef.current = null
  }, [backend])

  useEffect(() => {
    return () => {
      if (unsubRef.current) unsubRef.current()
    }
  }, [])

  return { messages, isStreaming, sendMessage, interrupt, reset }
}
