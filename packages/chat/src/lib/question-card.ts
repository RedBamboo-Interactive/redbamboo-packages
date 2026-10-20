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
 * Settled history has no live control state, so it continues to fall back to
 * the completed transcript part.
 */
export function resolveQuestionCardContent(
  pendingQuestion: PendingQuestion | null | undefined,
  askQuestionPart: MessagePart | undefined,
): QuestionCardContent | null {
  if (pendingQuestion) {
    return {
      question: pendingQuestion.question || "Claude is asking a question...",
      questions: pendingQuestion.questions ?? null,
    }
  }

  if (!askQuestionPart?.toolInput || askQuestionPart.isPartial) return null

  try {
    const parsed = JSON.parse(askQuestionPart.toolInput)
    const questions = parseStructuredQuestions(parsed)
    if (questions) {
      return {
        question: questions[0].question || "Claude is asking a question...",
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
