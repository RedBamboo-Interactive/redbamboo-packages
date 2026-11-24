import type { CSSProperties } from "react"
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

/** Provide an interaction colour only when Quiet muted this marker. */
export function friezeMarkerPaint(
  density: FriezeDensity,
  color: string,
  state?: Parameters<typeof friezeMarkerColor>[2],
): { color: string; highlight?: CSSProperties } {
  const restingColor = friezeMarkerColor(density, color, state)
  if (restingColor !== QUIET_MARKER) return { color: restingColor }
  return {
    color: `var(--frieze-marker-highlight, ${restingColor})`,
    highlight: { "--frieze-marker-accent": color } as CSSProperties,
  }
}

export function friezeMarkerFailed(part: MessagePart, result: MessagePart | undefined, color: string, deliveryFailed?: boolean): boolean {
  return !!deliveryFailed || part.type === "error" || part.task?.status === "failed"
    || (part.toolName === "event:agent-note-sent" && color === PART_COLOR.error) || isErrorResult(result)
}

export function friezeSummaryText(count: number, eventOnly: boolean, working: boolean): string {
  const noun = eventOnly ? "event" : "step"
  return `${working ? "Working · " : ""}${count} ${noun}${count === 1 ? "" : "s"}`
}
