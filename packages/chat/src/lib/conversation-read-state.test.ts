import { test } from "node:test"
import assert from "node:assert/strict"
import { hasUnreadConversation } from "./conversation-read-state.ts"

test("a newer conversation revision is unread", () => {
  assert.equal(hasUnreadConversation({ conversationRevision: 2, readConversationRevision: 1 }), true)
})

test("equal revisions are read", () => {
  assert.equal(hasUnreadConversation({ conversationRevision: 2, readConversationRevision: 2 }), false)
})

test("a defensive future read revision is not unread", () => {
  assert.equal(hasUnreadConversation({ conversationRevision: 2, readConversationRevision: 3 }), false)
})
