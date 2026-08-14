import assert from "node:assert/strict"
import test from "node:test"
import type { ChatQueueSnapshot, ChatQueueTransport } from "../types.ts"
import {
  connectRemoteMessageQueue,
  getRemoteMessageQueueStore,
  refreshRemoteMessageQueue,
  resetRemoteMessageQueueStores,
  settleRemoteMessageQueue,
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
        createdAt: "2026-08-14T20:00:00Z",
        updatedAt: "2026-08-14T20:00:01Z",
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

  assert.deepEqual(store.getSnapshot().queue, [{
    id: "client-1",
    remoteId: "q_server",
    clientId: "client-1",
    sessionId: "session-a",
    text: "hello",
    attachments: undefined,
    deliveryError: undefined,
    remoteState: "delivered",
    appearance: "message",
    delivery: "after-current",
    messageUid: "m1",
    deliveredMessageUid: undefined,
    createdAt: "2026-08-14T20:00:00Z",
    deliveredAt: "2026-08-14T20:00:01Z",
  }])

  settleRemoteMessageQueue("session-a", ["m1"])
  assert.deepEqual(store.getSnapshot().queue, [])
})

test("server acknowledgement preserves the optimistic visual identity and idle appearance", async () => {
  resetRemoteMessageQueueStores()
  const store = getRemoteMessageQueueStore("session-a")
  store.update(() => [{
    id: "client-1",
    sessionId: "session-a",
    text: "hello",
    optimistic: true,
    appearance: "message",
  }])
  let state: "pending" | "delivering" = "pending"
  const transport: ChatQueueTransport = {
    list: async () => ({
      items: [{
        id: "q_server",
        clientId: "client-1",
        sessionId: "session-a",
        sequence: 1,
        state,
        delivery: "after-current",
        displayContent: "hello",
        messageUid: "m1",
        createdAt: "2026-08-14T20:00:00Z",
        updatedAt: "2026-08-14T20:00:00Z",
        attemptCount: state === "pending" ? 0 : 1,
      }],
      queue: { depth: 1, state: state === "pending" ? "ready" : "delivering" },
    }),
    cancel: async () => { throw new Error("unused") },
    retry: async () => { throw new Error("unused") },
    sendNow: async () => {},
  }

  connectRemoteMessageQueue("session-a", transport)
  await refreshRemoteMessageQueue("session-a")
  assert.equal(store.getSnapshot().queue[0]?.id, "client-1")
  assert.equal(store.getSnapshot().queue[0]?.remoteId, "q_server")
  assert.equal(store.getSnapshot().queue[0]?.appearance, "message")

  state = "delivering"
  await refreshRemoteMessageQueue("session-a")
  assert.equal(store.getSnapshot().queue[0]?.id, "client-1")
  assert.equal(store.getSnapshot().queue[0]?.remoteState, "delivering")
  assert.equal(store.getSnapshot().queue[0]?.appearance, "message")
})

test("an identical authoritative refresh does not publish another visual revision", async () => {
  resetRemoteMessageQueueStores()
  const item = {
    id: "q_server",
    sessionId: "session-a",
    sequence: 1,
    state: "pending" as const,
    delivery: "after-current" as const,
    displayContent: "stable",
    messageUid: "m1",
    createdAt: "2026-08-14T20:00:00Z",
    updatedAt: "2026-08-14T20:00:00Z",
    attemptCount: 0,
  }
  const transport: ChatQueueTransport = {
    list: async () => ({ items: [item], queue: { depth: 1, state: "ready" } }),
    cancel: async () => item,
    retry: async () => item,
    sendNow: async () => {},
  }
  connectRemoteMessageQueue("session-a", transport)
  await refreshRemoteMessageQueue("session-a")
  const revision = getRemoteMessageQueueStore("session-a").getSnapshot().revision

  await refreshRemoteMessageQueue("session-a")

  assert.equal(getRemoteMessageQueueStore("session-a").getSnapshot().revision, revision)
})

test("a delivered receipt carries the canonical time needed for timeline ordering", async () => {
  resetRemoteMessageQueueStores()
  const store = getRemoteMessageQueueStore("session-a")
  store.update(() => [{
    id: "client-1",
    sessionId: "session-a",
    text: "follow-up",
    appearance: "queue",
    optimistic: true,
    createdAt: "2026-08-14T20:00:00Z",
  }])
  const item = {
    id: "q_server",
    clientId: "client-1",
    sessionId: "session-a",
    sequence: 1,
    state: "delivered" as const,
    delivery: "after-current" as const,
    displayContent: "follow-up",
    messageUid: "m1",
    deliveredMessageUid: "m1",
    createdAt: "2026-08-14T20:00:00Z",
    updatedAt: "2026-08-14T20:01:00Z",
    completedAt: "2026-08-14T20:00:59Z",
    attemptCount: 1,
  }
  const transport: ChatQueueTransport = {
    list: async () => ({ items: [item], queue: { depth: 0, state: "empty" } }),
    cancel: async () => item,
    retry: async () => item,
    sendNow: async () => {},
  }

  connectRemoteMessageQueue("session-a", transport)
  await refreshRemoteMessageQueue("session-a")

  assert.equal(store.getSnapshot().queue[0]?.appearance, "message")
  assert.equal(store.getSnapshot().queue[0]?.deliveredAt, item.completedAt)
})
