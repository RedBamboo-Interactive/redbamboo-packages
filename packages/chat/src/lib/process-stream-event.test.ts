import { test } from "node:test"
import assert from "node:assert/strict"
import { processStreamEvent } from "./process-stream-event.ts"
import { streamTargetIndex } from "./event-parts.ts"
import type { ChatEvent, MessageBlock } from "../types.ts"

// The stream extends one block at a time. It used to assume that block was
// always last, which broke as soon as a host appended an ambient event group
// mid-response: tokens went into the event group instead of the answer.

const ts = "2026-07-25T19:00:00.000Z"

const user = (text: string): MessageBlock =>
  ({ id: "u1", role: "user", parts: [{ type: "text", content: text }], timestamp: ts })

const events = (...keys: string[]): MessageBlock => ({
  id: `ev-${keys.join("-")}`,
  role: "assistant",
  timestamp: ts,
  parts: keys.map((k) => ({ type: "tool_use" as const, toolName: `event:${k}`, content: k })),
  metadata: { source: `event:${keys[0]}` },
})

const token = (content: string): ChatEvent =>
  ({ type: "text", content, toolName: null, toolInput: null, toolResult: null, messageId: null, messageUid: null })

const status = (content: string | null): ChatEvent =>
  ({ type: "status", content, toolName: null, toolInput: null, toolResult: null, messageId: null, messageUid: null })

const text = (block: MessageBlock) =>
  block.parts.filter((p) => p.type === "text").map((p) => p.content).join("")

const QUESTION_INPUT = {
  questions: [{
    question: "Which one?",
    header: "Pick",
    multiSelect: false,
    options: [{ label: "A" }, { label: "B" }],
  }],
}

/** The persisted tool_use block, which streams just before the question event. */
const ask = (): ChatEvent => ({
  type: "tool_use", content: null, toolName: "AskUserQuestion",
  toolInput: JSON.stringify({ question: "Which one?" }),
  toolResult: null, messageId: "toolu_1", messageUid: null,
})

/** The transient control event that actually parks the session. */
const question = (requestId: string): ChatEvent => ({
  type: "question", content: null, toolName: "AskUserQuestion",
  toolInput: JSON.stringify(QUESTION_INPUT),
  toolResult: null, messageId: "toolu_1", messageUid: null, requestId,
})

const resolved = (requestId: string, outcome: string): ChatEvent => ({
  type: "question_resolved", content: outcome, toolName: null, toolInput: null,
  toolResult: null, messageId: null, messageUid: null, requestId,
})

const toolResult = (content: string): ChatEvent => ({
  type: "tool_result", content, toolName: null, toolInput: null,
  toolResult: content, messageId: "toolu_1", messageUid: null,
})

test("streamTargetIndex treats a trailing event group as a chronological boundary", () => {
  const answer: MessageBlock = { id: "a1", role: "assistant", parts: [{ type: "text", content: "hi" }], timestamp: ts }
  assert.equal(streamTargetIndex([user("q"), answer]), 1)
  assert.equal(streamTargetIndex([user("q"), answer, events("weather")]), -1)
  assert.equal(streamTargetIndex([user("q"), answer, events("weather"), events("spotify")]), -1)
})

test("streamTargetIndex reports -1 when a new block is needed", () => {
  assert.equal(streamTargetIndex([]), -1)
  assert.equal(streamTargetIndex([user("q")]), -1)
  // A user message is the most recent conversation block, so the reply that
  // starts now is a new turn, even with ambient events sitting after it.
  assert.equal(streamTargetIndex([user("q"), events("weather")]), -1)
})

test("model output after an ambient event opens a chronological continuation", () => {
  let messages: MessageBlock[] = [user("q")]
  messages = processStreamEvent(messages, true, token("Hel")).messages
  messages = [...messages, events("weather")]
  messages = processStreamEvent(messages, true, token("lo")).messages

  assert.equal(messages.length, 4, "the event splits the streamed turn visually")
  assert.equal(text(messages[1]), "Hel")
  assert.equal(messages[2].parts[0].toolName, "event:weather")
  assert.equal(text(messages[3]), "lo")
  assert.ok(!messages[1].parts.some((part) => part.isPartial), "the earlier segment was finalized")
})

test("a new turn opens a block after the trailing events", () => {
  const messages = processStreamEvent([user("q"), events("weather")], true, token("Hi")).messages
  assert.equal(messages.length, 3)
  assert.equal(messages[1].parts[0].toolName, "event:weather", "events keep their place")
  assert.equal(text(messages[2]), "Hi")
})

test("status finalizes the answer even when events trail it", () => {
  let messages = processStreamEvent([user("q")], true, token("Hi")).messages
  messages = [...messages, events("weather")]
  assert.ok(messages[1].parts.some((p) => p.isPartial), "partial before status")

  const result = processStreamEvent(messages, true, {
    type: "status", content: null, toolName: null, toolInput: null, toolResult: null, messageId: null, messageUid: null,
  })
  assert.equal(result.isStreaming, false)
  assert.ok(!result.messages[1].parts.some((p) => p.isPartial), "answer finalized")
})

test("status on a list with no answer yet is a no-op", () => {
  const before: MessageBlock[] = [user("q"), events("weather")]
  const result = processStreamEvent(before, true, {
    type: "status", content: null, toolName: null, toolInput: null, toolResult: null, messageId: null, messageUid: null,
  })
  assert.equal(result.messages, before)
  assert.equal(result.isStreaming, false)
})

test("a pending question is detected behind a trailing event group", () => {
  const asked = processStreamEvent([user("q")], true, ask())
  assert.equal(asked.pendingQuestion?.question, "Which one?")

  // The same list once an ambient event has landed after the question.
  const withEvent = processStreamEvent([...asked.messages, events("weather")], true, token(""), false, asked.question)
  assert.equal(withEvent.pendingQuestion?.question, "Which one?")
})

test("consecutive text tokens concatenate into one part", () => {
  let messages = processStreamEvent([user("q")], true, token("a")).messages
  messages = processStreamEvent(messages, true, token("b")).messages
  messages = processStreamEvent(messages, true, token("c")).messages
  assert.equal(messages[1].parts.filter((p) => p.type === "text").length, 1)
  assert.equal(text(messages[1]), "abc")
})

// Regression coverage for the interrupt/kill/resume sequence: an SSE ack that
// an interrupt request was *received* is not the same as the turn being
// *over*, and a force-killed process is not the same as one that's safe to
// write to again. Getting either wrong lets a queued follow-up drain into a
// session that hasn't actually stopped (or hasn't come back yet).

test("an 'interrupting' status stays streaming and does not finalize the block", () => {
  const messages = processStreamEvent([user("q")], true, token("Hel")).messages
  const result = processStreamEvent(messages, true, status("interrupting"))
  assert.equal(result.isStreaming, true, "the turn has not unwound yet")
  assert.equal(result.interrupting, true)
  assert.equal(result.resumePending, false)
  assert.ok(result.messages[1].parts.some((p) => p.isPartial), "block left open, not finalized")
})

test("an 'interrupting' status preserves an existing pending question instead of nulling it", () => {
  const asked = processStreamEvent([user("q")], true, ask())
  const result = processStreamEvent(asked.messages, true, status("interrupting"), false, asked.question)
  assert.equal(result.pendingQuestion?.question, "Which one?", "not cleared by a transitional status")
})

test("an 'interrupted' status (the graceful ack after 'interrupting') is terminal and safe", () => {
  let messages = processStreamEvent([user("q")], true, token("Hel")).messages
  let result = processStreamEvent(messages, true, status("interrupting"))
  result = processStreamEvent(result.messages, result.isStreaming, status("interrupted"), result.resumePending)
  assert.equal(result.isStreaming, false)
  assert.equal(result.interrupting, false)
  assert.equal(result.resumePending, false, "safe to drain the queue")
  assert.ok(!result.messages[1].parts.some((p) => p.isPartial), "answer finalized")
})

test("a 'killed' status is terminal but NOT safe to write to — resumePending must block the drain", () => {
  const messages = processStreamEvent([user("q")], true, token("Hel")).messages
  const result = processStreamEvent(messages, true, status("killed"))
  assert.equal(result.isStreaming, false, "isStreaming alone is not enough to gate a drain here")
  assert.equal(result.resumePending, true, "the caller must check this before writing")
})

test("the 'idle' that follows a 'killed' resume clears resumePending", () => {
  const messages = processStreamEvent([user("q")], true, token("Hel")).messages
  const killed = processStreamEvent(messages, true, status("killed"))
  assert.equal(killed.resumePending, true)
  const resumed = processStreamEvent(killed.messages, killed.isStreaming, status("idle"), killed.resumePending)
  assert.equal(resumed.resumePending, false, "resume succeeded — safe to drain again")
  assert.equal(resumed.isStreaming, false)
})

test("an error following a 'killed' resume also clears resumePending", () => {
  const messages = processStreamEvent([user("q")], true, token("Hel")).messages
  const killed = processStreamEvent(messages, true, status("killed"))
  const failed = processStreamEvent(killed.messages, killed.isStreaming, {
    type: "error", content: "resume failed", toolName: null, toolInput: null, toolResult: null, messageId: null, messageUid: null,
  }, killed.resumePending)
  assert.equal(failed.resumePending, false)
  assert.equal(failed.isStreaming, false)
})

test("an unrecognized status string fails closed to terminal-and-safe", () => {
  const messages = processStreamEvent([user("q")], true, token("Hel")).messages
  // A future backend value (or a different provider's own vocabulary) this
  // build doesn't know about must behave like today's code: turn over, safe.
  const result = processStreamEvent(messages, true, status("some-future-status"))
  assert.equal(result.isStreaming, false)
  assert.equal(result.interrupting, false)
  assert.equal(result.resumePending, false)
})

test("a status with no content (older backends) is terminal-and-safe", () => {
  const messages = processStreamEvent([user("q")], true, token("Hel")).messages
  const result = processStreamEvent(messages, true, status(null))
  assert.equal(result.isStreaming, false)
  assert.equal(result.resumePending, false)
})

// --- AskUserQuestion lifecycle ---
//
// The card used to be inferred purely from the parts: an AskUserQuestion
// tool_use with no tool_result after it. That inference is what made the card
// render pre-greyed and ticked "Answered" — when nothing could answer the ask,
// the CLI's rejection came back as a tool_result, which the inference read as
// an answer. The lifecycle is now driven by the backend's `question` /
// `question_resolved` control events, which also carry the live requestId an
// answer has to echo. The inference stays as a fallback for backends that
// never send them.

test("a question event opens a pending question carrying the live requestId", () => {
  const asked = processStreamEvent([user("q")], true, ask())
  const result = processStreamEvent(asked.messages, true, question("req-1"), false, asked.question)

  assert.equal(result.pendingQuestion?.requestId, "req-1")
  assert.equal(result.pendingQuestion?.question, "Which one?")
  assert.deepEqual(result.pendingQuestion?.questions?.[0].options.map((o) => o.label), ["A", "B"])
  assert.equal(result.isStreaming, false, "the turn is parked on the user")
  assert.equal(result.question.outcome, null)
})

test("a question event adds no message part — it is control state, not conversation", () => {
  const asked = processStreamEvent([user("q")], true, ask())
  const before = asked.messages[1].parts.length
  const result = processStreamEvent(asked.messages, true, question("req-1"), false, asked.question)

  assert.equal(result.messages, asked.messages, "the list is untouched")
  assert.equal(result.messages[1].parts.length, before)
})

test("question_resolved clears the pending question and records that it was answered", () => {
  let r = processStreamEvent([user("q")], true, ask())
  r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
  r = processStreamEvent(r.messages, true, resolved("req-1", "answered"), false, r.question)

  assert.equal(r.pendingQuestion, null)
  assert.equal(r.question.outcome, "answered")
  assert.equal(r.isStreaming, true, "the turn resumes once the tool is unblocked")
})

test("timeout, cancelled and session_ended resolve as themselves, not as 'answered'", () => {
  for (const outcome of ["timeout", "cancelled", "session_ended", "declined"]) {
    let r = processStreamEvent([user("q")], true, ask())
    r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
    r = processStreamEvent(r.messages, true, resolved("req-1", outcome), false, r.question)

    assert.equal(r.pendingQuestion, null, `${outcome} drops the card`)
    assert.equal(r.question.outcome, outcome, `${outcome} is reported verbatim`)
  }
})

test("a session that ends under the question does not leave the composer streaming", () => {
  let r = processStreamEvent([user("q")], true, ask())
  r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
  r = processStreamEvent(r.messages, true, resolved("req-1", "session_ended"), false, r.question)
  assert.equal(r.isStreaming, false)
})

test("a recorded outcome survives the rest of the turn so the card keeps saying how it ended", () => {
  let r = processStreamEvent([user("q")], true, ask())
  r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
  r = processStreamEvent(r.messages, true, resolved("req-1", "timeout"), false, r.question)
  r = processStreamEvent(r.messages, true, toolResult("The question timed out"), false, r.question)
  r = processStreamEvent(r.messages, true, token("Carrying on"), false, r.question)

  assert.equal(r.question.outcome, "timeout", "not overwritten by the tool_result that follows")
  assert.equal(r.pendingQuestion, null)
})

test("an error tool_result does NOT mark a question answered when no resolution arrived", () => {
  // The original bug, in event form: the ask is rejected, the rejection comes
  // back as a tool_result, and nothing ever resolved the question.
  let r = processStreamEvent([user("q")], true, ask())
  r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
  r = processStreamEvent(r.messages, true, toolResult("<error>Answer questions?</error>"), false, r.question)

  assert.equal(r.pendingQuestion, null, "the card stops being interactive")
  assert.notEqual(r.question.outcome, "answered", "nobody answered it")
  assert.equal(r.question.outcome, "unresolved")
})

test("a terminal status closes an unanswered question without claiming it was answered", () => {
  let r = processStreamEvent([user("q")], true, ask())
  r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
  r = processStreamEvent(r.messages, true, status("idle"), false, r.question)

  assert.equal(r.pendingQuestion, null)
  assert.equal(r.question.outcome, "unresolved")
})

test("a question_resolved for some other request leaves the live question alone", () => {
  let r = processStreamEvent([user("q")], true, ask())
  r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
  const stale = processStreamEvent(r.messages, true, resolved("req-other", "timeout"), false, r.question)

  assert.equal(stale.pendingQuestion?.requestId, "req-1", "still waiting on its own answer")
  assert.equal(stale.question.outcome, null)
})

test("a resolved question is not re-opened by the parts it left behind", () => {
  // The tool_result trails the resolution by a beat. In that window the parts
  // still look like an unanswered AskUserQuestion — re-deriving from them would
  // put the card back up with no requestId, unanswerable.
  let r = processStreamEvent([user("q")], true, ask())
  r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
  r = processStreamEvent(r.messages, true, resolved("req-1", "answered"), false, r.question)
  r = processStreamEvent(r.messages, true, token("Right, "), false, r.question)

  assert.equal(r.pendingQuestion, null, "stays resolved")
  assert.equal(r.question.outcome, "answered")
})

test("a second question clears the previous outcome and picks up its own requestId", () => {
  let r = processStreamEvent([user("q")], true, ask())
  r = processStreamEvent(r.messages, true, question("req-1"), false, r.question)
  r = processStreamEvent(r.messages, true, resolved("req-1", "timeout"), false, r.question)
  r = processStreamEvent(r.messages, true, toolResult("The question timed out"), false, r.question)

  // The next AskUserQuestion tool_use must not inherit "timeout" — the card
  // would announce the previous question's fate on this one.
  r = processStreamEvent(r.messages, true, ask(), false, r.question)
  assert.equal(r.question.outcome, null, "the stale outcome is dropped")

  r = processStreamEvent(r.messages, true, question("req-2"), false, r.question)
  assert.equal(r.pendingQuestion?.requestId, "req-2")
})

test("backends that never send question events keep the old inferred behaviour", () => {
  // No question event anywhere in this stream: the card must still open on the
  // tool_use and close on the tool_result, exactly as before.
  let r = processStreamEvent([user("q")], true, ask())
  assert.equal(r.pendingQuestion?.question, "Which one?")
  assert.equal(r.pendingQuestion?.requestId, undefined, "nothing to echo back")
  assert.equal(r.isStreaming, false)

  r = processStreamEvent(r.messages, true, toolResult("Blue"), false, r.question)
  assert.equal(r.pendingQuestion, null)
  assert.equal(r.question.outcome, null, "an inferred question has no reportable outcome")
})
