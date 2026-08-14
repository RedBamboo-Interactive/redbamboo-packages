import assert from "node:assert/strict"
import test from "node:test"
import type { ChatQueueSnapshot, ChatQueueTransport } from "../types.ts"
import {
  connectRemoteMessageQueue,
  getRemoteMessageQueueStore,
  refreshRemoteMessageQueue,
  resetRemoteMessageQueueStores,
} from "./remote-message-queue-store.ts"

const empty: ChatQueueSnapshot = {
  items: [],
  queue: { depth: 0, state: "empty" },
}

test("an invalidation during an in-flight refresh forces a second authoritative read", async () => {
  resetRemoteMessageQueueStores()
  let releaseFirst!: (snapshot: ChatQueueSnapshot) => void
  let calls = 0
  const first = new Promise<ChatQueueSnapshot>(resolve => { releaseFirst = resolve })
  const second: ChatQueueSnapshot = {
    items: [{
      id: "q_server",
      sessionId: "session-a",
      sequence: 1,
      state: "pending",
      delivery: "after-current",
      displayContent: "arrived while refreshing",
      messageUid: "m1",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      attemptCount: 0,
    }],
    queue: { depth: 1, state: "waiting_for_session", blockedReason: "active_turn" },
  }
  const transport: ChatQueueTransport = {
    list: () => ++calls === 1 ? first : Promise.resolve(second),
    cancel: async () => second.items[0]!,
    retry: async () => second.items[0]!,
    sendNow: async () => {},
  }

  connectRemoteMessageQueue("session-a", transport)
  const converged = refreshRemoteMessageQueue("session-a")
  releaseFirst(empty)
  await converged

  assert.equal(calls, 2)
  assert.equal(getRemoteMessageQueueStore("session-a").getSnapshot().queue[0]?.id, "q_server")
})

test("a terminal receipt reconciles an optimistic outbox entry by client id", async () => {
  resetRemoteMessageQueueStores()
  const store = getRemoteMessageQueueStore("session-a")
  store.update(() => [{ id: "client-1", text: "hello", optimistic: true }])
  const transport: ChatQueueTransport = {
    list: async () => ({
      items: [{
        id: "q_server",
        clientId: "client-1",
        sessionId: "session-a",
        sequence: 1,
        state: "delivered",
        delivery: "after-current",
        displayContent: "hello",
        messageUid: "m1",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        attemptCount: 1,
      }],
      queue: { depth: 0, state: "empty" },
    }),
    cancel: async () => { throw new Error("unused") },
    retry: async () => { throw new Error("unused") },
    sendNow: async () => {},
  }

  connectRemoteMessageQueue("session-a", transport)
  await refreshRemoteMessageQueue("session-a")

  assert.deepEqual(store.getSnapshot().queue, [])
})
