import assert from "node:assert/strict"
import test from "node:test"
import type { QueuedMessage } from "./message-queue.ts"
import { loadQueue, saveQueue, type StorageLike } from "./message-queue-storage.ts"
import { admitWithOutbox, migrateLegacyOutbox, resetLegacyOutboxMigrations } from "./remote-message-outbox.ts"

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>()
  get length() { return this.values.size }
  key(index: number) { return [...this.values.keys()][index] ?? null }
  getItem(key: string) { return this.values.get(key) ?? null }
  setItem(key: string, value: string) { this.values.set(key, value) }
  removeItem(key: string) { this.values.delete(key) }
}

const message: QueuedMessage = { id: "client-1", sessionId: "session-a", text: "do not lose me" }

test("a new remote submission is recoverable before server acknowledgement", async () => {
  const storage = new MemoryStorage()
  let acknowledge!: () => void
  const pendingAck = new Promise<void>(resolve => { acknowledge = resolve })

  const admission = admitWithOutbox(storage, "session-a", message, () => pendingAck, 1000)

  assert.deepEqual(loadQueue(storage, "session-a"), [message])
  acknowledge()
  await admission
  assert.deepEqual(loadQueue(storage, "session-a"), [])
})

test("a failed final migration refresh always releases the per-session migration lease", async () => {
  resetLegacyOutboxMigrations()
  const storage = new MemoryStorage()
  saveQueue(storage, "session-a", [message], 1000)
  let submissions = 0

  await assert.rejects(() => migrateLegacyOutbox(
    storage,
    "session-a",
    async () => { submissions += 1; throw new Error("server unavailable") },
    async () => { throw new Error("refresh unavailable") },
  ))

  await migrateLegacyOutbox(
    storage,
    "session-a",
    async () => { submissions += 1 },
    async () => {},
  )

  assert.equal(submissions, 2)
  assert.deepEqual(loadQueue(storage, "session-a"), [])
})

test("legacy migration stops at the first unacknowledged item to preserve FIFO", async () => {
  resetLegacyOutboxMigrations()
  const storage = new MemoryStorage()
  const second = { ...message, id: "client-2", text: "second" }
  saveQueue(storage, "session-a", [message, second], 1000)
  const submitted: string[] = []

  await migrateLegacyOutbox(
    storage,
    "session-a",
    async item => { submitted.push(item.id); throw new Error("offline") },
    async () => {},
  )

  assert.deepEqual(submitted, ["client-1"])
  assert.deepEqual(loadQueue(storage, "session-a"), [message, second])
})

// 1df298f5: a first message refused during a maintenance drain was kept only as this outbox record.
// The remote store never showed it after a reload, and the migration re-sent it silently.
const refusedFirstMessage: QueuedMessage = {
  id: "q-6852f49a262c41b6b91e7caefe1aa2e0",
  messageUid: "6852f49a262c41b6b91e7caefe1aa2e0",
  sessionId: "1df298f5",
  text: "Make a video like the Cookbook video, but a unique one",
  delivery: "after-current",
  appearance: "queue",
  createdAt: "2026-11-25T18:36:25.644Z",
  timelineAt: "2026-11-25T18:36:25.644Z",
  optimistic: true,
  admissionUncertain: false,
  deliveryError: "Not sent: an update is waiting to restart Leaf. Your draft is kept on this device. Retry after the update finishes.",
}

test("a refused record is shown again as failed and is never re-sent by the migration", async () => {
  resetLegacyOutboxMigrations()
  const storage = new MemoryStorage()
  saveQueue(storage, "1df298f5", [refusedFirstMessage], 1000)
  const submitted: string[] = []
  const stranded: QueuedMessage[] = []

  await migrateLegacyOutbox(
    storage,
    "1df298f5",
    async item => { submitted.push(item.id) },
    async () => {},
    items => { stranded.push(...items) },
  )

  assert.deepEqual(submitted, [])
  assert.deepEqual(stranded, [refusedFirstMessage])
  // The record stays until the person retries, edits or cancels it.
  assert.deepEqual(loadQueue(storage, "1df298f5"), [refusedFirstMessage])
})

test("a refused record holds its successors back and shows them too", async () => {
  resetLegacyOutboxMigrations()
  const storage = new MemoryStorage()
  const later = { ...message, id: "client-later", sessionId: "1df298f5", text: "later" }
  saveQueue(storage, "1df298f5", [refusedFirstMessage, later], 1000)
  const submitted: string[] = []
  const stranded: QueuedMessage[] = []

  await migrateLegacyOutbox(storage, "1df298f5",
    async item => { submitted.push(item.id) }, async () => {}, items => { stranded.push(...items) })

  assert.deepEqual(submitted, [])
  assert.deepEqual(stranded.map(item => item.id), [refusedFirstMessage.id, "client-later"])
  assert.equal(stranded[0]!.deliveryError, refusedFirstMessage.deliveryError)
  assert.match(stranded[1]!.deliveryError ?? "", /earlier message/)
  assert.equal(stranded[1]!.optimistic, true)
})

test("an unconfirmed record whose re-send fails is shown as failed instead of vanishing", async () => {
  resetLegacyOutboxMigrations()
  const storage = new MemoryStorage()
  saveQueue(storage, "session-a", [message], 1000)
  const stranded: QueuedMessage[] = []

  await migrateLegacyOutbox(storage, "session-a",
    async () => { throw new Error("offline") }, async () => {}, items => { stranded.push(...items) })

  assert.equal(stranded.length, 1)
  assert.equal(stranded[0]!.id, message.id)
  assert.equal(stranded[0]!.optimistic, true)
  assert.equal(stranded[0]!.admissionUncertain, true)
  assert.match(stranded[0]!.deliveryError ?? "", /offline/)
  // Unconfirmed: the next mount may still re-send it under the same key.
  assert.deepEqual(loadQueue(storage, "session-a"), [message])
})

test("a record re-sent successfully is not shown as stranded", async () => {
  resetLegacyOutboxMigrations()
  const storage = new MemoryStorage()
  saveQueue(storage, "session-a", [message], 1000)
  const stranded: QueuedMessage[] = []

  await migrateLegacyOutbox(storage, "session-a", async () => {}, async () => {}, items => { stranded.push(...items) })

  assert.deepEqual(stranded, [])
  assert.deepEqual(loadQueue(storage, "session-a"), [])
})
