import type { ChatEvent, MessageBlock, MessagePart, PendingQuestion, ProcessEventResult, StructuredQuestion } from "../types"
// Explicit extension: this module is exercised by node:test, and bare Node ESM
// does not resolve extensionless relative specifiers.
import { streamTargetIndex } from "./event-parts.ts"

let partIdCounter = 0

function finalizePartials(block: MessageBlock): MessageBlock {
  const hasPartial = block.parts.some(p => p.isPartial)
  if (!hasPartial) return block
  return { ...block, parts: block.parts.map(p => p.isPartial ? { ...p, isPartial: false } : p) }
}

/** Close out the in-flight block's partial parts, wherever it sits in the list. */
export function finalizeStreamBlock(messages: MessageBlock[]): MessageBlock[] {
  const idx = streamTargetIndex(messages)
  if (idx === -1) return messages
  const finalized = finalizePartials(messages[idx])
  if (finalized === messages[idx]) return messages
  const updated = [...messages]
  updated[idx] = finalized
  return updated
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
  resumePending = false,
): ProcessEventResult {
  if (event.type === "status") {
    // "interrupting" fires the instant an interrupt request reaches the CLI's
    // stdin — an ack of receipt, not a turn-ended signal. The turn is still
    // unwinding (up to ~10s if a tool ignores cancellation), so this is NOT
    // terminal: isStreaming stays true and the block is not finalized.
    if (event.content === "interrupting") {
      const idx = streamTargetIndex(messages)
      const pendingQuestion = idx === -1 ? null : detectPendingQuestion(messages[idx])
      return { messages, isStreaming: true, pendingQuestion, interrupting: true, resumePending }
    }
    // Every other status is terminal. "killed" means the CLI process was
    // force-replaced and a write isn't safe until the follow-up "idle" (or an
    // "error" if the resume failed) arrives — anything else, including a
    // status string this build doesn't recognize, is treated as safe-to-write
    // so an unfamiliar provider's vocabulary fails closed to prior behaviour.
    return {
      messages: finalizeStreamBlock(messages),
      isStreaming: false,
      pendingQuestion: null,
      interrupting: false,
      resumePending: event.content === "killed",
    }
  }

  if (event.type === "error") {
    return {
      messages: finalizeStreamBlock(applyEvent(messages, event)),
      isStreaming: false,
      pendingQuestion: null,
      interrupting: false,
      resumePending: false,
    }
  }

  const msgs = applyEvent(messages, event)
  const idx = streamTargetIndex(msgs)
  const pendingQuestion = idx === -1 ? null : detectPendingQuestion(msgs[idx])
  const streamingOut = pendingQuestion ? false : isStreaming
  return { messages: msgs, isStreaming: streamingOut, pendingQuestion, interrupting: false, resumePending }
}

function applyEvent(messages: MessageBlock[], event: ChatEvent): MessageBlock[] {
  const msgs = [...messages]
  const idx = streamTargetIndex(msgs)
  let lastBlock: MessageBlock

  if (idx === -1) {
    // Prefer the server-minted message uid: the persisted records of this
    // turn carry the same value, so the block keeps its id across a reload.
    lastBlock = {
      id: event.messageUid || `assistant-${Date.now()}-${partIdCounter++}`,
      role: "assistant",
      parts: [],
      timestamp: new Date().toISOString(),
    }
    // Appended after any trailing event group: this turn genuinely starts now.
    msgs.push(lastBlock)
  } else {
    lastBlock = { ...msgs[idx], parts: [...msgs[idx].parts] }
    msgs[idx] = lastBlock
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
