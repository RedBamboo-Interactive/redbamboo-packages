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
