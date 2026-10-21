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

export function shouldQueueBusyDraftOnTab(options: {
  isStreaming: boolean
  hasContent: boolean
  shiftKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  metaKey?: boolean
}): boolean {
  return options.isStreaming && options.hasContent
    && !options.shiftKey && !options.ctrlKey && !options.altKey && !options.metaKey
}
