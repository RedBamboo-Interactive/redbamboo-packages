import assert from "node:assert/strict"
import test from "node:test"
import type { ChatEvent, MessageBlock, MessagePart, PendingQuestion, QuestionState } from "../types"
import { processStreamEvent } from "./process-stream-event.ts"
import { resolveQuestionCardContent } from "./question-card.ts"

const toolInput = JSON.stringify({
  questions: [{
    question: "Which one?",
    header: "Choice",
    multiSelect: false,
    options: [{ label: "A" }, { label: "B" }],
  }],
})

const partialAsk: MessagePart = {
  type: "tool_use",
  content: "",
  toolName: "AskUserQuestion",
  toolInput,
  isPartial: true,
}

test("a live question renders from control state while its tool-use part is partial", () => {
  const pending: PendingQuestion = {
    question: "Which one?",
    questions: [{
      question: "Which one?",
      header: "Choice",
      multiSelect: false,
      options: [{ label: "A" }, { label: "B" }],
    }],
    requestId: "req-1",
  }

  const card = resolveQuestionCardContent(pending, partialAsk)

  assert.equal(card?.question, "Which one?")
  assert.deepEqual(card?.questions?.[0].options.map(option => option.label), ["A", "B"])
})

test("a transcript part renders without control state, partial or settled", () => {
  assert.equal(resolveQuestionCardContent(null, partialAsk)?.question, "Which one?")
  assert.equal(resolveQuestionCardContent(null, { ...partialAsk, isPartial: false })?.question, "Which one?")
})

test("the card stays up through the whole question lifecycle", () => {
  // question_resolved clears the control state before the tool result settles
  // the part, so the card must not blink out in between.
  const base = { content: null, toolName: null, toolInput: null, toolResult: null, messageId: null, messageUid: null }
  const sequence: ChatEvent[] = [
    { ...base, type: "tool_use", toolName: "AskUserQuestion", toolInput, messageId: "toolu_1" },
    { ...base, type: "question", toolName: "AskUserQuestion", toolInput, messageId: "toolu_1", requestId: "r1" },
    { ...base, type: "question_resolved", content: "answered", requestId: "r1" },
    { ...base, type: "tool_result", content: "A", toolResult: "A", messageId: "toolu_1" },
  ]
  let messages: MessageBlock[] = [{ id: "u1", role: "user", parts: [{ type: "text", content: "hi" }], timestamp: "2026-10-21T10:00:00.000Z" }]
  let question: QuestionState | undefined
  let streaming = true
  for (const event of sequence) {
    const result = processStreamEvent(messages, streaming, event, false, question)
    ;({ messages, question, isStreaming: streaming } = result)
    const ask = messages.at(-1)?.parts.find(p => p.type === "tool_use" && p.toolName === "AskUserQuestion")
    const card = resolveQuestionCardContent(result.pendingQuestion, ask)
    assert.equal(card?.questions?.[0].options.length, 2, `card missing after ${event.type}`)
  }
})
