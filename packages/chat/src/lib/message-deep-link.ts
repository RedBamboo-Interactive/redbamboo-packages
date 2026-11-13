/** The query parameter a link uses to name one message of a conversation. */
export const MESSAGE_PARAM = "message"

export interface MessageDeepLinkState {
  /** The message named in the address, if any. */
  uid: string | null
  /** The conversation named in the address. */
  conversationId: string | null
  /** The conversation the chat has selected. */
  activeConversationId: string | null
  /** True until the chat has that conversation's messages to look through. */
  loading: boolean
  /** The conversation and message already acted on, so a re-render can't ask twice. */
  handled: string | null
}

export type MessageDeepLinkStep =
  | { action: "none" }
  | { action: "wait" }
  | { action: "go"; uid: string; handled: string }

/**
 * What a `?message=` should do now: wait until its conversation is the one on screen and has loaded,
 * then go there once. Framework-free so the order can be exercised deterministically.
 */
export function messageDeepLinkStep(state: MessageDeepLinkState): MessageDeepLinkStep {
  if (!state.uid || !state.conversationId) return { action: "none" }
  const key = `${state.conversationId}\n${state.uid}`
  if (state.handled === key) return { action: "none" }
  if (state.activeConversationId !== state.conversationId || state.loading) return { action: "wait" }
  return { action: "go", uid: state.uid, handled: key }
}

/** The same address without the message: it has done its work, and Back shouldn't repeat it. */
export function withoutMessageParam(search: string): string {
  const params = new URLSearchParams(search)
  params.delete(MESSAGE_PARAM)
  const text = params.toString()
  return text ? `?${text}` : ""
}
