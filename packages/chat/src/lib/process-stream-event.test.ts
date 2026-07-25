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

const text = (block: MessageBlock) =>
  block.parts.filter((p) => p.type === "text").map((p) => p.content).join("")

test("streamTargetIndex finds the answer behind a trailing event group", () => {
  const answer: MessageBlock = { id: "a1", role: "assistant", parts: [{ type: "text", content: "hi" }], timestamp: ts }
  assert.equal(streamTargetIndex([user("q"), answer]), 1)
  assert.equal(streamTargetIndex([user("q"), answer, events("weather")]), 1)
  assert.equal(streamTargetIndex([user("q"), answer, events("weather"), events("spotify")]), 1)
})

test("streamTargetIndex reports -1 when a new block is needed", () => {
  assert.equal(streamTargetIndex([]), -1)
  assert.equal(streamTargetIndex([user("q")]), -1)
  // A user message is the most recent conversation block, so the reply that
  // starts now is a new turn, even with ambient events sitting after it.
  assert.equal(streamTargetIndex([user("q"), events("weather")]), -1)
})

test("tokens land in the answer, not in a trailing event group", () => {
  let messages: MessageBlock[] = [user("q")]
  messages = processStreamEvent(messages, true, token("Hel")).messages
  messages = [...messages, events("weather")]
  messages = processStreamEvent(messages, true, token("lo")).messages

  assert.equal(messages.length, 3, "no extra block was opened")
  assert.equal(text(messages[1]), "Hello")
  assert.equal(messages[2].parts.length, 1, "the event group was left alone")
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
  const ask: ChatEvent = {
    type: "tool_use", content: null, toolName: "AskUserQuestion",
    toolInput: JSON.stringify({ question: "Which one?" }),
    toolResult: null, messageId: null, messageUid: null,
  }
  const asked = processStreamEvent([user("q")], true, ask)
  assert.equal(asked.pendingQuestion?.question, "Which one?")

  // The same list once an ambient event has landed after the question.
  const withEvent = processStreamEvent([...asked.messages, events("weather")], true, token(""))
  assert.equal(withEvent.pendingQuestion?.question, "Which one?")
})

test("consecutive text tokens concatenate into one part", () => {
  let messages = processStreamEvent([user("q")], true, token("a")).messages
  messages = processStreamEvent(messages, true, token("b")).messages
  messages = processStreamEvent(messages, true, token("c")).messages
  assert.equal(messages[1].parts.filter((p) => p.type === "text").length, 1)
  assert.equal(text(messages[1]), "abc")
})
