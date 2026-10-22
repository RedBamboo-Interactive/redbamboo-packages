import type { MessageBlock, MessagePart } from "../types"
import { isEventBlock, isEventPart } from "./event-parts.ts"
import { getToolActivityCategory } from "./tool-semantics.ts"

export const PART_COLOR = {
  thinking: "var(--color-domain-imagination, #7C4DFF)",
  // Work handed to another worker: Nova delegations, subagents, Leaf agent tools.
  delegation: "rgb(236 72 153)",
  readOnly: "var(--color-accent-teal)",
  mutating: "var(--color-accent-gold)",
  shell: "var(--color-accent-gold)",
  result: "color-mix(in oklch, var(--color-accent-teal), black 30%)",
  error: "var(--color-accent-red)",
  event: "var(--color-text-disabled)",
  fallback: "var(--color-text-disabled)",
} as const

function getEventMeta(part: MessagePart): { color?: string; icon?: string } {
  if (!part.toolInput) return {}
  try {
    const data = JSON.parse(part.toolInput)
    return { color: data.color ?? undefined, icon: data.icon ?? undefined }
  } catch { return {} }
}

/**
 * A launching square takes its background task's outcome: stopped or failed is
 * red, lost (the provider process died) is grey. Running and completed keep the
 * tool's own colour; running is shown by motion, not colour.
 */
function taskOutcomeColor(part: MessagePart): string | null {
  const status = part.task?.status
  if (status === "stopped" || status === "failed") return PART_COLOR.error
  if (status === "lost") return PART_COLOR.fallback
  return null
}

export function getPartColor(part: MessagePart): string {
  const outcome = taskOutcomeColor(part)
  if (outcome) return outcome
  if (part.type === "thinking") return PART_COLOR.thinking
  if (part.type === "error") return PART_COLOR.error
  if (part.type === "tool_result") return PART_COLOR.result
  if (isEventPart(part)) {
    const meta = getEventMeta(part)
    return meta.color ?? PART_COLOR.event
  }
  if (part.type === "tool_use" && part.toolName) {
    const category = getToolActivityCategory(part.toolName, part.toolInput)
    if (category === "agent") return PART_COLOR.delegation
    if (category === "read-only") return PART_COLOR.readOnly
    if (category === "mutating") return PART_COLOR.mutating
    if (category === "shell") return PART_COLOR.shell
  }
  return PART_COLOR.fallback
}

/**
 * Colour of the main turn's current activity. Reads only the turn's own parts:
 * background work hangs off launching parts as `children` and never colours
 * the main spinner.
 */
export function getSpinnerColor(messages: MessageBlock[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const block = messages[i]
    // Ambient event groups can trail the in-flight block; they say nothing
    // about what the model is currently doing.
    if (block.role !== "assistant" || isEventBlock(block)) continue
    for (let j = block.parts.length - 1; j >= 0; j--) {
      const part = block.parts[j]
      if (part.parentToolUseId) continue
      if (part.type === "thinking") return PART_COLOR.thinking
      if (part.type === "tool_use" && part.toolName) {
        const category = getToolActivityCategory(part.toolName, part.toolInput)
        if (category === "agent") return PART_COLOR.delegation
        if (category === "read-only") return PART_COLOR.readOnly
        if (category === "mutating") return PART_COLOR.mutating
        if (category === "shell") return PART_COLOR.shell
      }
      if (part.type === "text") return PART_COLOR.readOnly
    }
  }
  return PART_COLOR.readOnly
}

/** A launching square animates for as long as its background task runs, turn or no turn. */
export function isBackgroundRunning(part: MessagePart): boolean {
  return part.task?.status === "running"
}
