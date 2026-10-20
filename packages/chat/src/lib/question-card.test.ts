import assert from "node:assert/strict"
import test from "node:test"
import type { MessagePart, PendingQuestion } from "../types"
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

test("a partial transcript part alone stays hidden until it is complete", () => {
  assert.equal(resolveQuestionCardContent(null, partialAsk), null)

  const card = resolveQuestionCardContent(null, { ...partialAsk, isPartial: false })
  assert.equal(card?.question, "Which one?")
})
