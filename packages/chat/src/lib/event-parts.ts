import type { MessageBlock, MessagePart } from "../types"

/**
 * Pure predicates over event parts, with no React or component dependency, so
 * they can be imported directly via the `@redbamboo/chat/event-parts` subpath
 * from plain Node (tests, tooling) as well as from the main barrel.
 *
 * Frieze events are ambient world facts a host interleaves into a conversation
 * (Nova's weather/music/discussion timeline). They ride on `tool_use` parts
 * named `event:<key>` so they render as frieze dots and open a detail modal,
 * but they are not something the model wrote.
 *
 * The distinction matters wherever code asks "which block is the model's
 * current turn?" — the answer must skip event blocks, because a host may append
 * one at any moment, including while a response is still streaming.
 */
export const EVENT_TOOL_PREFIX = "event:"

export function isEventPart(part: MessagePart): boolean {
  return part.type === "tool_use" && !!part.toolName?.startsWith(EVENT_TOOL_PREFIX)
}

/** True for a block carrying only frieze events, i.e. ambient, not a model turn. */
export function isEventBlock(block: MessageBlock): boolean {
  return block.parts.length > 0 && block.parts.every(isEventPart)
}

/**
 * Index of the assistant block a stream event should extend. An ambient event
 * is a chronological boundary: once one has been appended, later model output
 * opens a continuation block after it instead of reaching backward and making
 * new activity appear before an event that was already on screen.
 */
export function streamTargetIndex(messages: MessageBlock[]): number {
  const index = messages.length - 1
  if (index < 0) return -1
  const block = messages[index]
  return block.role === "assistant" && !isEventBlock(block) ? index : -1
}
