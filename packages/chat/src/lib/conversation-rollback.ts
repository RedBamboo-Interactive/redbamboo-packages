import type { ContextMenuEntry } from "@redbamboo/ui"
import type { MessageBlock } from "../types"
import { isEventBlock } from "./event-parts.ts"
import { stripHiddenMessageEnvelopes } from "./message-content.ts"
import { parseNovaEvent } from "./nova-event.ts"

/**
 * Stream event type: the session's transcript moved to a new epoch because a rollback removed part
 * of it. Carries the new epoch and the sequence the rotation consumed.
 */
export const TRANSCRIPT_RESET_EVENT = "transcript_reset"

export const REWIND_LABEL = "Rewind to before this message"
export const REWIND_ICON = "ph-bold ph-arrow-counter-clockwise"

export interface RollbackIdleState {
  supported: boolean
  disabled: boolean
  isStreaming: boolean
  interrupting: boolean
  resumePending: boolean
  questionPending: boolean
  queuedCount: number
  runningBackgroundTaskCount: number
}

/**
 * Whether to offer the action at all. The server decides for real and says why not: this only keeps
 * an action off the screen that could not work right now.
 */
export function canOfferRollback(state: RollbackIdleState): boolean {
  return state.supported
    && !state.disabled
    && !state.isStreaming
    && !state.interrupting
    && !state.resumePending
    && !state.questionPending
    && state.queuedCount === 0
    && state.runningBackgroundTaskCount === 0
}

/** A message the person wrote: not a machine event, a task notification or a local echo. */
export function isRewindableMessage(block: MessageBlock): boolean {
  if (block.role !== "user" || isEventBlock(block)) return false
  const raw = block.parts[0]?.content ?? ""
  if (raw.includes("<task-notification>") || parseNovaEvent(raw)) return false
  return !!block.id
}

/** The menu entry for a person's message, or nothing when it cannot be rewound to. */
export function rollbackMessageEntries(
  block: MessageBlock,
  available: boolean,
  open: (messageUid: string) => void,
): ContextMenuEntry[] {
  if (!available || !isRewindableMessage(block)) return []
  const uid = String(block.id)
  return [{ id: "message-rewind", label: REWIND_LABEL, icon: REWIND_ICON, run: () => open(uid) }]
}

/** What an error or refusal row rewinds to: the person's message that led to it. */
export function rollbackTargetBefore(messages: readonly MessageBlock[], index: number): string | null {
  for (let i = Math.min(index, messages.length - 1); i >= 0; i--) {
    if (isRewindableMessage(messages[i])) return String(messages[i].id)
  }
  return null
}

export function hasErrorPart(block: MessageBlock): boolean {
  return block.role !== "user" && block.parts.some(part => part.type === "error")
}

/** The removed text as the person wrote it, for the composer. */
export function restoredDraftText(text: string | null | undefined): string {
  return stripHiddenMessageEnvelopes(text ?? "").trim()
}

/** Puts removed text ahead of what the person had started typing, so nothing is lost. */
export function mergeRestoredDraft(restored: string, current: string): string {
  if (!restored) return current
  return current.trim() ? `${restored}\n\n${current}` : restored
}
