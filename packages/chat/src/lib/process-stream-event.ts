import type { ChatEvent, MessageBlock, MessagePart, PendingQuestion, ProcessEventResult, QuestionOutcome, QuestionState, StructuredQuestion } from "../types"
// Explicit extension: this module is exercised by node:test, and bare Node ESM
// does not resolve extensionless relative specifiers.
import { isEventBlock, streamTargetIndex } from "./event-parts.ts"

let partIdCounter = 0

function finalizePartials(block: MessageBlock): MessageBlock {
  const hasPartial = block.parts.some(p => p.isPartial)
  if (!hasPartial) return block
  return { ...block, parts: block.parts.map(p => p.isPartial ? { ...p, isPartial: false } : p) }
}

/** Close every partial segment of the in-flight turn. Ambient events can split
 * one turn into chronological continuation blocks. */
export function finalizeStreamBlock(messages: MessageBlock[]): MessageBlock[] {
  let changed = false
  const finalized = messages.map((block) => {
    const next = block.role === "assistant" && !isEventBlock(block) ? finalizePartials(block) : block
    changed ||= next !== block
    return next
  })
  return changed ? finalized : messages
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

/** Read `{question, questions}` out of an AskUserQuestion tool input blob. */
function readQuestion(toolInput: string | null | undefined): PendingQuestion {
  let question = "Claude is asking a question..."
  let questions: StructuredQuestion[] | undefined
  try {
    const raw = typeof toolInput === "string" ? JSON.parse(toolInput) : toolInput
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

/**
 * Fallback for backends that never emit `question` events: infer a pending
 * question from an AskUserQuestion tool_use with nothing answering it yet.
 *
 * This inference used to be the *only* path, and that was the bug — a tool
 * that was rejected rather than answered still produces a tool_result, so the
 * card was born already resolved and ticked "Answered". It survives only as a
 * compatibility path and is switched off the moment the stream proves it
 * speaks the newer protocol (see `nextQuestion`).
 */
function detectPendingQuestion(block: MessageBlock): PendingQuestion | null {
  for (let i = block.parts.length - 1; i >= 0; i--) {
    const part = block.parts[i]
    if (part.type === "tool_use" && part.toolName === "AskUserQuestion") {
      const hasResult = block.parts.slice(i + 1).some(p => p.type === "tool_result")
      if (hasResult) return null
      return readQuestion(part.toolInput)
    }
  }
  return null
}

const KNOWN_OUTCOMES = new Set<string>(["answered", "declined", "timeout", "cancelled", "session_ended"])

const NO_QUESTION: QuestionState = { pending: null, outcome: null }

function toOutcome(content: string | null | undefined): QuestionOutcome {
  // An unfamiliar outcome string is still a resolution; "answered" is the
  // benign reading and matches what older backends meant by saying nothing.
  return content && KNOWN_OUTCOMES.has(content) ? content as QuestionOutcome : "answered"
}

/**
 * Advance the question lifecycle for one event.
 *
 * A pending question is *opened* by a `question` event (the only thing that
 * carries a live requestId) and closed by `question_resolved`, by the turn
 * ending, or — as a last resort — by a tool_result landing on it. It is never
 * re-derived from the parts once the stream has shown it speaks this protocol,
 * because that would silently drop the requestId the answer has to echo.
 */
function nextQuestion(prev: QuestionState, msgs: MessageBlock[], event: ChatEvent): QuestionState {
  if (event.type === "question") {
    return {
      pending: { ...readQuestion(event.toolInput), requestId: event.requestId ?? null },
      outcome: null,
    }
  }

  if (event.type === "question_resolved") {
    // A resolution for some *other* request is stale (two questions can overlap
    // if the model asked twice); leave the live one alone.
    if (prev.pending?.requestId && event.requestId && prev.pending.requestId !== event.requestId) {
      return prev
    }
    return { pending: null, outcome: toOutcome(event.content) }
  }

  // A tool_result on a still-pending question means the tool call finished
  // without anyone answering — the backend emits `question_resolved` before the
  // CLI's tool_result, so reaching here with something pending means no
  // resolution ever arrived. That is emphatically not "Answered".
  if (event.type === "tool_result" && prev.pending) {
    return { pending: null, outcome: prev.pending.requestId ? "unresolved" : null }
  }

  // An open question stays open: only the events above can close it.
  if (prev.pending) return prev

  // A freshly streamed AskUserQuestion tool_use is unambiguously a *new*
  // question starting — how the last one ended is no longer what the card
  // should be saying. Inferring from it also puts the card up immediately,
  // ahead of the question event that upgrades it with the requestId.
  const opensQuestion = event.type === "tool_use" && event.toolName === "AskUserQuestion"

  // Compatibility path — see detectPendingQuestion. Outside that opening event,
  // a recorded outcome proves the backend speaks the newer protocol, so stop
  // guessing: re-deriving a question from the parts would lose its requestId.
  if (prev.outcome !== null && !opensQuestion) return prev
  const idx = streamTargetIndex(msgs)
  const inferred = idx === -1 ? null : detectPendingQuestion(msgs[idx])
  if (!inferred) return opensQuestion ? { pending: null, outcome: null } : prev
  return { pending: inferred, outcome: null }
}

export function processStreamEvent(
  messages: MessageBlock[],
  isStreaming: boolean,
  event: ChatEvent,
  resumePending = false,
  question: QuestionState = NO_QUESTION,
): ProcessEventResult {
  if (event.type === "status") {
    // "interrupting" fires the instant an interrupt request reaches the CLI's
    // stdin — an ack of receipt, not a turn-ended signal. The turn is still
    // unwinding (up to ~10s if a tool ignores cancellation), so this is NOT
    // terminal: isStreaming stays true and the block is not finalized.
    if (event.content === "interrupting") {
      const q = nextQuestion(question, messages, event)
      return { messages, isStreaming: true, pendingQuestion: q.pending, question: q, interrupting: true, resumePending }
    }
    // Every other status is terminal. "killed" means the CLI process was
    // force-replaced and a write isn't safe until the follow-up "idle" (or an
    // "error" if the resume failed) arrives — anything else, including a
    // status string this build doesn't recognize, is treated as safe-to-write
    // so an unfamiliar provider's vocabulary fails closed to prior behaviour.
    //
    // The turn is over, so nothing can still be waiting on an answer; any
    // outcome already recorded is kept so the card keeps saying how it ended.
    return {
      messages: finalizeStreamBlock(messages),
      isStreaming: false,
      pendingQuestion: null,
      question: closeQuestion(question),
      interrupting: false,
      resumePending: event.content === "killed",
    }
  }

  if (event.type === "error") {
    return {
      messages: finalizeStreamBlock(applyEvent(messages, event)),
      isStreaming: false,
      pendingQuestion: null,
      question: closeQuestion(question),
      interrupting: false,
      resumePending: false,
    }
  }

  // Control events carry no conversation content: they move the question
  // lifecycle and leave the message list untouched. (MessagePart has no such
  // kind, and appending one would render as a stray frieze square.)
  const isControl = event.type === "question" || event.type === "question_resolved"
  const msgs = isControl ? messages : applyEvent(messages, event)
  const q = nextQuestion(question, msgs, event)
  // A pending question parks the turn: the backend is blocked on the user, so
  // the composer must look idle even though the turn hasn't ended. Resolving it
  // hands the turn back — except for "session_ended", which resolves the card
  // by tearing the session down, and nothing is going to resume after it.
  const endedUnderQuestion = event.type === "question_resolved" && q.outcome === "session_ended"
  const streamingOut = q.pending || endedUnderQuestion ? false : isStreaming
  return { messages: msgs, isStreaming: streamingOut, pendingQuestion: q.pending, question: q, interrupting: false, resumePending }
}

/** Drop anything still pending without claiming it was answered. */
function closeQuestion(question: QuestionState): QuestionState {
  if (!question.pending) return question
  return { pending: null, outcome: question.pending.requestId ? "unresolved" : question.outcome }
}

function applyEvent(messages: MessageBlock[], event: ChatEvent): MessageBlock[] {
  let msgs = [...messages]
  let idx = streamTargetIndex(msgs)
  const incomingTurnUid = event.messageUid || null

  if (idx !== -1 && incomingTurnUid) {
    const target = msgs[idx]
    const targetTurnUid = typeof target.metadata?.messageUid === "string"
      ? target.metadata.messageUid
      : null
    const targetIsOpen = target.parts.some(part => part.isPartial)

    // Transcript refresh can lag the live stream: the first event for a new
    // turn may arrive while the previous assistant block is still the tail.
    // A provider-neutral uid is the authoritative turn boundary. For legacy
    // uid-less blocks, a finalized tail is likewise previous-turn history;
    // only an actually open partial is safe to extend.
    if ((targetTurnUid && targetTurnUid !== incomingTurnUid) || (!targetTurnUid && !targetIsOpen)) {
      idx = -1
    }
  }
  let lastBlock: MessageBlock

  if (idx === -1) {
    // A trailing ambient event closes the previous visual segment. Finalize it
    // before opening the continuation so no old dot keeps animating forever.
    msgs = finalizeStreamBlock(msgs)
    const timestamp = event.timestamp || new Date().toISOString()
    const turnUid = event.messageUid || null
    const priorSegments = turnUid
      ? msgs.filter((block) => block.role === "assistant" && (
          block.id === turnUid
          || block.metadata?.messageUid === turnUid
          || block.id.startsWith(`${turnUid}:segment:`)
        )).length
      : 0
    // Prefer the server-minted message uid: the persisted records of this
    // turn carry the same value. Continuations need a unique React identity
    // while retaining the canonical uid in metadata.
    lastBlock = {
      id: turnUid
        ? (priorSegments === 0 ? turnUid : `${turnUid}:segment:${priorSegments}`)
        : `assistant-${Date.now()}-${partIdCounter++}`,
      role: "assistant",
      parts: [],
      timestamp,
      metadata: turnUid ? { messageUid: turnUid } : undefined,
    }
    // Appended after any trailing event group. This may begin a new turn or
    // continue the same turn after an ambient chronological boundary.
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
    payloadRef: event.payloadRef || undefined,
    phase: event.phase || undefined,
  }

  if (event.type === "text" && lastBlock.parts.length > 0) {
    const lastPart = lastBlock.parts[lastBlock.parts.length - 1]
    if (lastPart.type === "text" && lastPart.phase === part.phase) {
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
