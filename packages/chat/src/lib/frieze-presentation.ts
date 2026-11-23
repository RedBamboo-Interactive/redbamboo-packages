import type { FriezeDensity, MessagePart } from "../types"
import { PART_COLOR } from "./part-colors.ts"

const QUIET_MARKER = "color-mix(in srgb, var(--color-text-disabled) 70%, transparent)"

export function isErrorResult(result: MessagePart | undefined): boolean {
  return result?.type === "tool_result" && !!result.content?.toLowerCase().startsWith("error")
}

export function friezeMarkerColor(
  density: FriezeDensity,
  color: string,
  { active = false, failed = false, needsAttention = false } = {},
): string {
  if (density !== "quiet") return color
  if (failed) return PART_COLOR.error
  return active || needsAttention ? color : QUIET_MARKER
}

export function friezeMarkerFailed(part: MessagePart, result: MessagePart | undefined, color: string, deliveryFailed?: boolean): boolean {
  return !!deliveryFailed || part.type === "error" || part.task?.status === "failed"
    || (part.toolName === "event:agent-note-sent" && color === PART_COLOR.error) || isErrorResult(result)
}

export function friezeSummaryText(count: number, eventOnly: boolean, working: boolean): string {
  const noun = eventOnly ? "event" : "step"
  return `${working ? "Working · " : ""}${count} ${noun}${count === 1 ? "" : "s"}`
}
