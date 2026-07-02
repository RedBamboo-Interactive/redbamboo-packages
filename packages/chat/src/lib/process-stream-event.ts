import type { ChatEvent, MessageBlock, MessagePart, PendingQuestion, ProcessEventResult, StructuredQuestion } from "../types"

let partIdCounter = 0

function finalizePartials(block: MessageBlock): MessageBlock {
  const hasPartial = block.parts.some(p => p.isPartial)
  if (!hasPartial) return block
  return { ...block, parts: block.parts.map(p => p.isPartial ? { ...p, isPartial: false } : p) }
}

export function parseStructuredQuestions(raw: Record<string, unknown>): StructuredQuestion[] | undefined {
  if (!("questions" in raw) || !Array.isArray(raw.questions) || raw.questions.length === 0) return undefined
  return (raw.questions as Record<string, unknown>[]).map((q) => ({
    question: typeof q.question === "string" ? q.question : "",
    header: typeof q.header === "string" ? q.header : undefined,
    multiSelect: !!q.multiSelect,
    options: Array.isArray(q.options)
      ? (q.options as Record<string, unknown>[]).map((o) => ({
          label: typeof o === "string" ? o : (typeof o.label === "string" ? o.label : ""),
          description: typeof o === "string" ? undefined : (typeof o.description === "string" ? o.description : undefined),
        }))
      : [],
  }))
}

function detectPendingQuestion(block: MessageBlock): PendingQuestion | null {
  for (let i = block.parts.length - 1; i >= 0; i--) {
    const part = block.parts[i]
    if (part.type === "tool_use" && part.toolName === "AskUserQuestion") {
      const hasResult = block.parts.slice(i + 1).some(p => p.type === "tool_result")
      if (hasResult) return null
      let question = "Claude is asking a question..."
      let questions: StructuredQuestion[] | undefined
      try {
        const raw = typeof part.toolInput === "string" ? JSON.parse(part.toolInput) : part.toolInput
        if (raw && typeof raw === "object") {
          questions = parseStructuredQuestions(raw as Record<string, unknown>)
          if (questions) {
            question = questions[0].question || question
          } else if ("question" in raw && typeof (raw as Record<string, unknown>).question === "string") {
            question = (raw as { question: string }).question
          }
        }
      } catch { /* use fallback */ }
      return { question, questions }
    }
  }
  return null
}

export function processStreamEvent(
  messages: MessageBlock[],
  isStreaming: boolean,
  event: ChatEvent,
): ProcessEventResult {
  if (event.type === "status") {
    if (!messages.length) return { messages, isStreaming: false, pendingQuestion: null }
    const lastBlock = messages[messages.length - 1]
    if (lastBlock.role !== "assistant") return { messages, isStreaming: false, pendingQuestion: null }
    const finalized = finalizePartials(lastBlock)
    const updated = finalized === lastBlock ? messages : [...messages.slice(0, -1), finalized]
    return { messages: updated, isStreaming: false, pendingQuestion: null }
  }

  if (event.type === "error") {
    const msgs = applyEvent(messages, event)
    const lastBlock = msgs[msgs.length - 1]
    const finalized = lastBlock?.role === "assistant" ? finalizePartials(lastBlock) : lastBlock
    const updated = finalized === lastBlock ? msgs : [...msgs.slice(0, -1), finalized]
    return { messages: updated, isStreaming: false, pendingQuestion: null }
  }

  const msgs = applyEvent(messages, event)
  const lastBlock = msgs[msgs.length - 1]
  const pendingQuestion = lastBlock?.role === "assistant" ? detectPendingQuestion(lastBlock) : null
  const streamingOut = pendingQuestion ? false : isStreaming
  return { messages: msgs, isStreaming: streamingOut, pendingQuestion }
}

function applyEvent(messages: MessageBlock[], event: ChatEvent): MessageBlock[] {
  const msgs = [...messages]
  let lastBlock = msgs[msgs.length - 1]

  if (!lastBlock || lastBlock.role !== "assistant") {
    // Prefer the server-minted message uid: the persisted records of this
    // turn carry the same value, so the block keeps its id across a reload.
    lastBlock = {
      id: event.messageUid || `assistant-${Date.now()}-${partIdCounter++}`,
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
}
