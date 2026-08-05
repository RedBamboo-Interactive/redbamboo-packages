import assert from "node:assert/strict"
import test from "node:test"
import { createMessageQueueStore } from "./message-queue-store.ts"
import type { QueuedMessage } from "./message-queue.ts"

const message = (id: string, text: string): QueuedMessage => ({ id, text })

test("multiple views share one queue and only one can claim its drain", () => {
  const persisted: QueuedMessage[][] = []
  const store = createMessageQueueStore([], queue => persisted.push(queue))
  let firstNotifications = 0
  let secondNotifications = 0
  store.subscribe(() => { firstNotifications += 1 })
  store.subscribe(() => { secondNotifications += 1 })

  store.update(queue => [...queue, message("a", "hello")])
  assert.deepEqual(store.getSnapshot().queue, [message("a", "hello")])
  assert.equal(firstNotifications, 1)
  assert.equal(secondNotifications, 1)

  const firstClaim = store.claimDrain()
  const competingClaim = store.claimDrain()
  assert.equal(firstClaim?.sent.text, "hello")
  assert.equal(competingClaim, null)
  assert.deepEqual(store.getSnapshot().queue, [])
  assert.equal(store.getSnapshot().draining, true)

  firstClaim?.complete()
  assert.equal(store.getSnapshot().draining, false)
  assert.deepEqual(persisted, [[message("a", "hello")], []])
})

test("messages added during a drain wait for the lease to complete", () => {
  const store = createMessageQueueStore([message("a", "first")])
  const claim = store.claimDrain()
  store.update(queue => [...queue, message("b", "second")])

  assert.equal(store.claimDrain(), null)
  claim?.complete()

  const next = store.claimDrain()
  assert.equal(next?.sent.text, "second")
})

test("a failed drain is recovered once for every subscribed view", () => {
  const store = createMessageQueueStore([message("a", "hello")])
  const claim = store.claimDrain()
  claim?.fail("network down")
  claim?.fail("duplicate failure")

  assert.equal(store.getSnapshot().draining, false)
  assert.equal(store.getSnapshot().queue.length, 1)
  assert.equal(store.getSnapshot().queue[0]?.text, "hello")
  assert.equal(store.getSnapshot().queue[0]?.deliveryError, "network down")
})
