import assert from "node:assert/strict"
import test from "node:test"
import type { ChatEvent, MessageBlock, QuestionState } from "../types"
import { processStreamEvent } from "./process-stream-event.ts"
import { resolveQuestionCardContent } from "./question-card.ts"
import {
  answerableQuestion,
  approvalsOnParts,
  isPermissionQuestion,
  permissionOutcome,
  readPermissionRequest,
  unanchoredApprovals,
  visibleApprovals,
} from "./permission-approval.ts"

const base = { content: null, toolName: null, toolInput: null, toolResult: null, messageId: null, messageUid: null }
const bashInput = JSON.stringify({ command: "rm -rf build", description: "Clean the build" })
const askInput = JSON.stringify({
  questions: [{ question: "Which one?", header: "Choice", multiSelect: false, options: [{ label: "A" }, { label: "B" }] }],
})
const user: MessageBlock = { id: "u1", role: "user", parts: [{ type: "text", content: "clean up" }], timestamp: "2026-11-09T10:00:00.000Z" }

const permissionQuestion = (toolUseId: string, requestId: string, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  ...base,
  type: "question",
  kind: "permission",
  requestId,
  toolName: "Bash",
  toolInput: bashInput,
  messageId: toolUseId,
  permission: {
    toolName: "Bash",
    toolUseId,
    summary: "rm -rf build",
    input: { command: "rm -rf build" },
    cwd: "T:/Projects/demo",
    options: ["allow_once", "allow_session", "deny"],
  },
  ...extra,
})

interface Replay {
  messages: MessageBlock[]
  question: QuestionState | undefined
  streaming: boolean
}

function replay(events: ChatEvent[], each?: (state: Replay & { pendingQuestion: ReturnType<typeof processStreamEvent>["pendingQuestion"] }, event: ChatEvent) => void): Replay {
  let state: Replay = { messages: [user], question: undefined, streaming: true }
  for (const event of events) {
    const result = processStreamEvent(state.messages, state.streaming, event, false, state.question)
    // Hosts keep passing streaming=true while the stream is live, as use-chat-stream does.
    state = { messages: result.messages, question: result.question, streaming: result.isStreaming || event.type !== "status" }
    each?.({ ...state, streaming: result.isStreaming, pendingQuestion: result.pendingQuestion }, event)
  }
  return state
}

function cardOn(state: Replay, toolUseId: string) {
  const approvals = visibleApprovals(state.question?.permissions, state.question?.pending)
  const block = state.messages.find(message => message.parts.some(part => part.toolUseId === toolUseId))
  assert.ok(block, `the tool call ${toolUseId} is in the transcript`)
  return approvalsOnParts(block.parts, approvals).get(toolUseId)
}

test("an approval card stays on its tool call from the request through the tool result, with its outcome", () => {
  const sequence: ChatEvent[] = [
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
    { ...base, type: "question_resolved", content: "allow_once", requestId: "req-1" },
    { ...base, type: "tool_result", content: "", toolResult: "", messageId: "toolu_bash" },
  ]
  const seen: string[] = []
  replay(sequence, (state, event) => {
    if (event.type === "tool_use") {
      // Before the request opens there's nothing to approve yet.
      assert.equal(cardOn(state, "toolu_bash"), undefined)
      return
    }
    const card = cardOn(state, "toolu_bash")
    assert.ok(card, `card missing after ${event.type}`)
    seen.push(`${event.type}:${card.outcome ?? "pending"}`)
    assert.equal(card.request.summary, "rm -rf build")
    assert.equal(card.request.cwd, "T:/Projects/demo")
    if (event.type === "question") {
      assert.equal(state.streaming, false, "a waiting approval parks the turn")
      assert.ok(isPermissionQuestion(state.pendingQuestion))
      assert.equal(state.pendingQuestion?.requestId, "req-1")
      assert.equal(answerableQuestion(state.pendingQuestion), null, "the composer must not answer an approval")
    }
    if (event.type === "question_resolved") assert.equal(state.streaming, true, "the decision hands the turn back")
  })
  assert.deepEqual(seen, ["question:pending", "question_resolved:allow_once", "tool_result:allow_once"])
})

test("an approval never touches the AskUserQuestion outcome or card", () => {
  const sequence: ChatEvent[] = [
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
  ]
  const state = replay(sequence)
  assert.equal(state.question?.outcome, null)
  const pending = answerableQuestion(state.question?.pending)
  assert.equal(resolveQuestionCardContent(pending, undefined), null, "no question card for an approval")
  const resolved = replay([...sequence, { ...base, type: "question_resolved", content: "deny", requestId: "req-1" }])
  assert.equal(resolved.question?.outcome, null)
  assert.equal(resolved.question?.permissions?.toolu_bash.outcome, "deny")
})

test("a question without kind still runs the AskUserQuestion lifecycle exactly as before", () => {
  const sequence: ChatEvent[] = [
    { ...base, type: "tool_use", toolName: "AskUserQuestion", toolInput: askInput, messageId: "toolu_ask" },
    { ...base, type: "question", toolName: "AskUserQuestion", toolInput: askInput, messageId: "toolu_ask", requestId: "q1" },
    { ...base, type: "question_resolved", content: "answered", requestId: "q1" },
    { ...base, type: "tool_result", content: "A", toolResult: "A", messageId: "toolu_ask" },
  ]
  const states: (QuestionState | undefined)[] = []
  replay(sequence, (state, event) => {
    states.push(state.question)
    const ask = state.messages.at(-1)?.parts.find(part => part.type === "tool_use" && part.toolName === "AskUserQuestion")
    const card = resolveQuestionCardContent(answerableQuestion(state.pendingQuestion), ask)
    assert.equal(card?.questions?.[0].options.length, 2, `question card missing after ${event.type}`)
    if (event.type === "question") assert.equal(answerableQuestion(state.pendingQuestion)?.requestId, "q1")
  })
  // No approvals were seen, so the state keeps its old shape (no `permissions` key).
  for (const state of states) assert.equal(state && "permissions" in state, false)
  assert.deepEqual(states.at(-2), { pending: null, outcome: "answered" })
})

test("a parallel tool call's result does not settle a waiting approval", () => {
  const state = replay([
    { ...base, type: "tool_use", toolName: "Read", toolInput: "{}", messageId: "toolu_read" },
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
    { ...base, type: "tool_result", content: "file", toolResult: "file", messageId: "toolu_read" },
  ])
  assert.equal(state.question?.pending?.requestId, "req-1")
  assert.equal(state.question?.permissions?.toolu_bash.outcome, null)
})

test("the tool's own result before any resolution marks the approval unresolved, not allowed", () => {
  const state = replay([
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
    { ...base, type: "tool_result", content: "denied", toolResult: "denied", messageId: "toolu_bash" },
  ])
  assert.equal(state.question?.pending, null)
  assert.equal(state.question?.permissions?.toolu_bash.outcome, "unresolved")
})

test("a stale resolution for another request leaves the waiting approval alone", () => {
  const state = replay([
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
    { ...base, type: "question_resolved", content: "deny", requestId: "req-other" },
  ])
  assert.equal(state.question?.pending?.requestId, "req-1")
  assert.equal(state.question?.permissions?.toolu_bash.outcome, null)
})

test("two approvals: resolving the newer one leaves the turn parked on the older", () => {
  const state = replay([
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_a" },
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_b" },
    permissionQuestion("toolu_a", "req-a"),
    permissionQuestion("toolu_b", "req-b"),
    { ...base, type: "question_resolved", content: "allow_session", requestId: "req-b" },
  ])
  assert.equal(state.question?.pending?.requestId, "req-a")
  assert.equal(state.question?.permissions?.toolu_b.outcome, "allow_session")
  assert.equal(state.question?.permissions?.toolu_a.outcome, null)
})

test("an approval opening under a parked AskUserQuestion keeps the question answerable", () => {
  const state = replay([
    { ...base, type: "tool_use", toolName: "AskUserQuestion", toolInput: askInput, messageId: "toolu_ask" },
    { ...base, type: "question", toolName: "AskUserQuestion", toolInput: askInput, messageId: "toolu_ask", requestId: "q1" },
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
  ])
  assert.equal(answerableQuestion(state.question?.pending)?.requestId, "q1")
  assert.equal(state.question?.permissions?.toolu_bash.outcome, null)
})

test("answering the question parked above an approval leaves the turn parked on the approval", () => {
  let streaming = true
  const state = replay([
    { ...base, type: "tool_use", toolName: "AskUserQuestion", toolInput: askInput, messageId: "toolu_ask" },
    { ...base, type: "question", toolName: "AskUserQuestion", toolInput: askInput, messageId: "toolu_ask", requestId: "q1" },
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
    { ...base, type: "question_resolved", content: "answered", requestId: "q1" },
  ], result => { streaming = result.streaming })
  assert.equal(state.question?.outcome, "answered")
  assert.equal(state.question?.pending?.requestId, "req-1")
  assert.ok(isPermissionQuestion(state.question?.pending))
  assert.equal(streaming, false)
})

test("the turn ending abandons a waiting approval and keeps settled ones", () => {
  const state = replay([
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_a" },
    permissionQuestion("toolu_a", "req-a"),
    { ...base, type: "question_resolved", content: "allow_once", requestId: "req-a" },
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_b" },
    permissionQuestion("toolu_b", "req-b"),
    { ...base, type: "status", content: "idle" },
  ])
  assert.equal(state.question?.pending, null)
  assert.equal(state.question?.permissions?.toolu_a.outcome, "allow_once")
  assert.equal(state.question?.permissions?.toolu_b.outcome, "unresolved")
})

test("a session ending under an approval stops streaming", () => {
  let streaming = true
  replay([
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
    { ...base, type: "question_resolved", content: "session_ended", requestId: "req-1" },
  ], state => { streaming = state.streaming })
  assert.equal(streaming, false)
})

test("a sparse permission event is read from its tool fields", () => {
  const request = readPermissionRequest({ ...base, type: "question", kind: "permission", requestId: "r", toolName: "Write", toolInput: JSON.stringify({ file_path: "src/a.ts", content: "x" }), messageId: "toolu_w" })
  assert.deepEqual(request, {
    toolName: "Write",
    toolUseId: "toolu_w",
    summary: "src/a.ts",
    input: { file_path: "src/a.ts", content: "x" },
    cwd: null,
    options: ["allow_once", "allow_session", "deny"],
  })
})

test("resolution outcomes read the decision first, then the content", () => {
  assert.equal(permissionOutcome({ content: "answered", decision: "allow_session" }), "allow_session")
  assert.equal(permissionOutcome({ content: "allow_once" }), "allow_once")
  assert.equal(permissionOutcome({ content: "denied" }), "deny")
  assert.equal(permissionOutcome({ content: "declined" }), "deny")
  assert.equal(permissionOutcome({ content: "timeout" }), "timeout")
  assert.equal(permissionOutcome({ content: "session_ended" }), "session_ended")
  assert.equal(permissionOutcome({ content: "something new" }), "answered")
})

test("a generic resolution doesn't erase a decision the client already recorded", () => {
  // e.g. use-chat-stream settles the card once its POST succeeds, then the server's event lands.
  const opened = replay([
    { ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" },
    permissionQuestion("toolu_bash", "req-1"),
    { ...base, type: "question_resolved", content: "allow_session", requestId: "req-1" },
  ])
  const result = processStreamEvent(opened.messages, true, { ...base, type: "question_resolved", content: "answered", requestId: "req-1" }, false, opened.question)
  assert.equal(result.question.permissions?.toolu_bash.outcome, "allow_session")
  assert.equal(result.question.outcome, null)
})

test("a pending approval a host put in state from a snapshot is drawn and resolved", () => {
  const messages: MessageBlock[] = [user, { id: "a1", role: "assistant", timestamp: user.timestamp, parts: [{ type: "tool_use", content: "", toolName: "Bash", toolInput: bashInput, toolUseId: "toolu_bash" }] }]
  const pending = { question: "Allow Bash?", requestId: "req-1", kind: "permission" as const, permission: { toolName: "Bash", toolUseId: "toolu_bash", summary: "rm -rf build" } }
  assert.equal(approvalsOnParts(messages[1].parts, visibleApprovals(undefined, pending)).get("toolu_bash")?.outcome, null)
  const result = processStreamEvent(messages, true, { ...base, type: "question_resolved", content: "deny", requestId: "req-1" }, false, { pending, outcome: null })
  assert.equal(result.pendingQuestion, null)
  assert.equal(result.question.permissions?.toolu_bash.outcome, "deny")
  assert.equal(result.question.outcome, null)
})

test("an approval whose tool call isn't loaded falls back to a standalone card", () => {
  const approvals = visibleApprovals(undefined, { question: "Allow Bash?", requestId: "r", kind: "permission", permission: { toolName: "Bash", toolUseId: "toolu_elsewhere" } })
  assert.equal(unanchoredApprovals([user], approvals).length, 1)
  const noId = visibleApprovals(undefined, { question: "Allow?", requestId: "r2", kind: "permission", permission: { toolName: "WebFetch" } })
  assert.equal(unanchoredApprovals([user], noId).length, 1)
})

test("settled history renders from the transcript alone: no approval state, no card", () => {
  const settled: MessageBlock = { id: "a1", role: "assistant", timestamp: user.timestamp, parts: [
    { type: "tool_use", content: "", toolName: "Bash", toolInput: bashInput, toolUseId: "toolu_bash" },
    { type: "tool_result", content: "", toolUseId: "toolu_bash" },
  ] }
  assert.equal(approvalsOnParts(settled.parts, visibleApprovals(undefined, null)).size, 0)
})
