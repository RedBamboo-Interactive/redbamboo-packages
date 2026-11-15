import type { MessagePart } from "../types"
import { EVENT_TOOL_PREFIX, isEventPart } from "./event-parts.ts"
import { getToolActivityCategory, type ToolActivityCategory } from "./tool-semantics.ts"

/**
 * Frieze marker visibility is a viewer preference. A host decides which kinds
 * of dot or square it wants to see; the transcript, persistence, model delivery
 * and unread state never change. Hosts filter on the stable keys below rather
 * than reimplementing the classification.
 */
export type FriezeToolCategory = ToolActivityCategory | "other"

export const FRIEZE_TOOL_CATEGORIES: readonly FriezeToolCategory[] = ["read-only", "mutating", "shell", "agent", "other"]

/** `event:<key>`, `tool:<category>`, `thinking` or `error`. */
export type FriezeMarkerKey = `event:${string}` | `tool:${FriezeToolCategory}` | "thinking" | "error"

/** Predicate a host supplies: false hides the marker. Never consulted for a marker that needs attention. */
export type FriezeMarkerVisibility = (part: MessagePart) => boolean

/**
 * The marker kind a part draws, or null when it draws no marker of its own (a
 * tool_result is reached through its tool_use; text, audio and images are content).
 * An event's key is its toolName after `event:`, up to any further `:` qualifier.
 */
export function friezeMarkerKey(part: MessagePart): FriezeMarkerKey | null {
  if (part.type === "thinking") return "thinking"
  if (part.type === "error") return "error"
  if (part.type !== "tool_use") return null
  if (isEventPart(part)) return `event:${part.toolName!.slice(EVENT_TOOL_PREFIX.length).split(":")[0] ?? ""}`
  return `tool:${getToolActivityCategory(part.toolName, part.toolInput) ?? "other"}`
}

const CARD_TOOLS = new Set(["AskUserQuestion", "ExitPlanMode"])

/**
 * A marker that needs attention is drawn whatever the host prefers: an error,
 * anything still in flight (streaming, a running background task), a task that
 * failed or was stopped, a call that owns a question/plan card or an approval,
 * and an event input still queued (pending or failed delivery).
 */
export function friezeMarkerNeedsAttention(
  part: MessagePart,
  context: { queued?: boolean; approval?: boolean } = {},
): boolean {
  if (part.type === "error") return true
  if (part.isPartial) return true
  const status = part.task?.status
  if (status === "running" || status === "failed" || status === "stopped") return true
  if (part.type === "tool_use" && part.toolName && CARD_TOOLS.has(part.toolName)) return true
  return !!context.queued || !!context.approval
}

/**
 * `parts` without the markers `isShown` rejects, and without the results those
 * hidden calls own, so a result can never be re-paired with a neighbouring call.
 * Result ownership follows `findPairedResult`: the call with the same toolUseId,
 * else (a result without one) the nearest preceding call. `kept[i]` is the
 * original index of the returned `parts[i]`.
 */
export function filterFriezeParts(
  parts: readonly MessagePart[],
  isShown: FriezeMarkerVisibility,
): { parts: MessagePart[]; kept: number[] } {
  const hiddenCalls = new Set<MessagePart>()
  const callsById = new Map<string, MessagePart>()
  for (const part of parts) {
    if (part.type === "tool_use" && part.toolUseId && !callsById.has(part.toolUseId)) callsById.set(part.toolUseId, part)
  }
  const out: MessagePart[] = []
  const kept: number[] = []
  let previousCall: MessagePart | undefined
  parts.forEach((part, index) => {
    if (part.type === "tool_result") {
      const owner = part.toolUseId ? callsById.get(part.toolUseId) : previousCall
      if (owner && hiddenCalls.has(owner)) return
    } else if (friezeMarkerKey(part) && !isShown(part)) {
      if (part.type === "tool_use") {
        hiddenCalls.add(part)
        previousCall = part
      }
      return
    }
    if (part.type === "tool_use") previousCall = part
    out.push(part)
    kept.push(index)
  })
  return { parts: out, kept }
}
