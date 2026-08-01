import { test } from "node:test"
import assert from "node:assert/strict"
import {
  loadQueue, saveQueue, pruneStaleQueues, MAX_QUEUE_AGE_MS, MAX_STORED_SESSIONS,
  type StorageLike,
} from "./message-queue-storage.ts"
import type { QueuedMessage } from "./message-queue.ts"

// In-memory stand-in for window.localStorage — the test harness has no DOM.
class FakeStorage implements StorageLike {
  private map = new Map<string, string>()
  getItem(key: string) { return this.map.has(key) ? this.map.get(key)! : null }
  setItem(key: string, value: string) { this.map.set(key, value) }
  removeItem(key: string) { this.map.delete(key) }
  key(index: number) { return Array.from(this.map.keys())[index] ?? null }
  get length() { return this.map.size }
}

const msg = (id: string, text: string): QueuedMessage => ({ id, text })

test("save then load round-trips the queue for a session", () => {
  const storage = new FakeStorage()
  const queue = [msg("a", "hello"), msg("b", "world")]
  saveQueue(storage, "session-1", queue, 1000)
  assert.deepEqual(loadQueue(storage, "session-1"), queue)
})

test("staged attachment metadata survives queue refresh without bytes", () => {
  const storage = new FakeStorage()
  const attachment = { id: "att_123", kind: "file" as const, name: "proposal.pdf", mediaType: "application/pdf", size: 42, downloadUrl: "/attachment" }
  const queue: QueuedMessage[] = [{ id: "a", text: "", attachments: [attachment], deliveryError: "try again" }]
  saveQueue(storage, "session-files", queue, 1000)
  assert.deepEqual(loadQueue(storage, "session-files"), queue)
  assert.equal(storage.getItem("rb-chat-queue:session-files")?.includes("base64"), false)
})

test("loading an unknown session returns an empty queue, not an error", () => {
  const storage = new FakeStorage()
  assert.deepEqual(loadQueue(storage, "never-saved"), [])
})

test("saving an empty queue clears the stored entry instead of persisting []", () => {
  const storage = new FakeStorage()
  saveQueue(storage, "session-1", [msg("a", "hi")], 1000)
  assert.equal(storage.length, 1)
  saveQueue(storage, "session-1", [], 2000)
  assert.equal(storage.length, 0)
  assert.deepEqual(loadQueue(storage, "session-1"), [])
})

test("loading corrupt JSON degrades to an empty queue", () => {
  const storage = new FakeStorage()
  storage.setItem("rb-chat-queue:session-1", "{not json")
  assert.deepEqual(loadQueue(storage, "session-1"), [])
})

test("sessions are isolated from one another", () => {
  const storage = new FakeStorage()
  saveQueue(storage, "session-1", [msg("a", "one")], 1000)
  saveQueue(storage, "session-2", [msg("b", "two")], 1000)
  assert.deepEqual(loadQueue(storage, "session-1"), [msg("a", "one")])
  assert.deepEqual(loadQueue(storage, "session-2"), [msg("b", "two")])
})

test("pruneStaleQueues drops entries older than MAX_QUEUE_AGE_MS", () => {
  const storage = new FakeStorage()
  const now = 1_000_000_000
  saveQueue(storage, "fresh", [msg("a", "hi")], now - 1000)
  saveQueue(storage, "stale", [msg("b", "hi")], now - MAX_QUEUE_AGE_MS - 1)
  pruneStaleQueues(storage, now)
  assert.deepEqual(loadQueue(storage, "fresh"), [msg("a", "hi")])
  assert.deepEqual(loadQueue(storage, "stale"), [])
})

test("pruneStaleQueues keeps only the MAX_STORED_SESSIONS most recent sessions", () => {
  const storage = new FakeStorage()
  const now = 1_000_000_000
  const total = MAX_STORED_SESSIONS + 5
  for (let i = 0; i < total; i++) {
    saveQueue(storage, `session-${i}`, [msg("m", "hi")], now - i) // session-0 is newest
  }
  pruneStaleQueues(storage, now)
  assert.equal(storage.length, MAX_STORED_SESSIONS)
  for (let i = 0; i < MAX_STORED_SESSIONS; i++) {
    assert.deepEqual(loadQueue(storage, `session-${i}`), [msg("m", "hi")], `session-${i} should survive`)
  }
  for (let i = MAX_STORED_SESSIONS; i < total; i++) {
    assert.deepEqual(loadQueue(storage, `session-${i}`), [], `session-${i} should be pruned as overflow`)
  }
})

test("pruneStaleQueues ignores unrelated localStorage keys", () => {
  const storage = new FakeStorage()
  storage.setItem("some-other-app-key", "untouched")
  pruneStaleQueues(storage, Date.now())
  assert.equal(storage.getItem("some-other-app-key"), "untouched")
})
