import type { MessageBlock } from "../types"
import { isEventBlock } from "./event-parts.ts"

export interface ChatStatusPresentation {
  color: string
  icon?: string
  label: string
}

export const CONTEXT_COMPACTION_TOOL_NAME = "ContextCompaction"

/** Compaction is a provider activity within a live turn, represented by an
 * unresolved tool pair so the same state survives live delivery and a
 * mid-compaction history reload. */
export function isContextCompactionActive(messages: MessageBlock[]): boolean {
  let turnStart = messages.length - 1
  while (turnStart >= 0 && messages[turnStart]?.role !== "user") turnStart--
  const parts = messages.slice(turnStart + 1)
    .filter((block) => block.role === "assistant" && !isEventBlock(block))
    .flatMap((block) => block.parts)

  let active = false
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index]!
    if (part.type !== "tool_use" || part.toolName !== CONTEXT_COMPACTION_TOOL_NAME) continue
    active = true
    for (let next = index + 1; next < parts.length; next++) {
      if (parts[next]!.type === "tool_use") {
        active = false
        break
      }
      if (parts[next]!.type === "tool_result") {
        active = false
        break
      }
    }
  }
  return active
}

export function getChatStatusPresentation({
  isStreaming,
  isReconnecting,
  streamingColor,
  isCompacting = false,
}: {
  isStreaming: boolean
  isReconnecting: boolean
  streamingColor: string
  isCompacting?: boolean
}): ChatStatusPresentation | null {
  if (isReconnecting) {
    return {
      color: "#ef4444",
      icon: "ph-bold ph-arrows-clockwise",
      label: "Reconnecting...",
    }
  }

  if (!isStreaming) return null

  if (isCompacting) {
    return {
      color: "var(--color-text-disabled)",
      label: "Compacting context...",
    }
  }

  return {
    color: streamingColor,
    label: "Responding...",
  }
}
