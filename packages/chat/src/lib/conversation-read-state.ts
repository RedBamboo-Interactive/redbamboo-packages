export interface ConversationReadState {
  conversationRevision: number
  readConversationRevision: number
}

/**
 * A conversation is unread when its backend has published conversational
 * output beyond the revision the viewer has actually rendered.
 */
export function hasUnreadConversation(state: ConversationReadState): boolean {
  return state.conversationRevision > state.readConversationRevision
}
