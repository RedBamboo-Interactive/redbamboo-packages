import type { MessagePart, PendingQuestion, StructuredQuestion } from "../types"
import { parseStructuredQuestions } from "./process-stream-event.ts"

export interface QuestionCardContent {
  question: string
  questions: StructuredQuestion[] | null
}

/**
 * Resolve the content shown by a question card.
 *
 * A live `question` control event is authoritative and may arrive while the
 * matching AskUserQuestion tool-use part is still marked partial. Prefer its
 * payload so the card does not wait for a later tool result to become visible.
 * Without live control state (settled history, or the gap between
 * `question_resolved` and the tool result) the card falls back to the
 * transcript part. That part may still be marked partial: the stream keeps the
 * tail part partial until another part follows, and nothing follows a parked
 * question until its tool result. Tool-use input is never accumulated across
 * events, so a partial AskUserQuestion part already carries its full input.
 */
export function resolveQuestionCardContent(
  pendingQuestion: PendingQuestion | null | undefined,
  askQuestionPart: MessagePart | undefined,
): QuestionCardContent | null {
  if (pendingQuestion) {
    return {
      question: pendingQuestion.question || "The assistant is asking a question...",
      questions: pendingQuestion.questions ?? null,
    }
  }

  if (!askQuestionPart?.toolInput) return null

  try {
    const parsed = JSON.parse(askQuestionPart.toolInput)
    const questions = parseStructuredQuestions(parsed)
    if (questions) {
      return {
        question: questions[0].question || "The assistant is asking a question...",
        questions,
      }
    }
    if (typeof parsed.question === "string") {
      return { question: parsed.question, questions: null }
    }
  } catch {
    return { question: askQuestionPart.toolInput, questions: null }
  }

  return null
}
