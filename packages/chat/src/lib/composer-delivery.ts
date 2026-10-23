import type { SendOptions } from "../types.ts"

export function composerDelivery(options: {
  isStreaming: boolean
  supportsSteering: boolean
  interruptToo?: boolean
  queueAfterCurrent?: boolean
}): NonNullable<SendOptions["delivery"]> {
  if (options.interruptToo) return "interrupt-current"
  if (options.isStreaming && options.supportsSteering && !options.queueAfterCurrent)
    return "steer-current"
  return "after-current"
}

// Tab owns any non-empty draft: it queues while busy and sends when idle, so a
// turn ending between typing and the keypress never turns it into focus
// traversal. An empty draft keeps native Tab focus behaviour.
export function shouldSubmitDraftOnTab(options: {
  hasContent: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}): boolean {
  return options.hasContent
    && !options.shiftKey && !options.ctrlKey && !options.altKey && !options.metaKey
}
