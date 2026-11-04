import { test } from "node:test"
import assert from "node:assert/strict"
import { placeQueuedEvents, queuedItemsByInputUid, isVisibleOutgoingMessage, canonicalUserMessageUids, type QueuedMessage } from "./message-queue.ts"
import { queuedMessageStatusLabel } from "./queue-status.ts"
import type { MessageBlock, MessagePart } from "../types.ts"

const T0 = "2026-11-04T07:42:41.000Z"
const T1 = "2026-11-04T07:50:00.000Z"
const T2 = "2026-11-04T07:57:10.000Z"

const eventPart = (uid: string, inputPlaced?: boolean): MessagePart => ({
  type: "tool_use", toolName: "event:agent-note", content: uid, messageUid: uid, ...(inputPlaced ? { inputPlaced } : {}),
})
const text = (id: string, timestamp: string): MessageBlock => ({
  id, role: "assistant", timestamp, parts: [{ type: "text", content: id }], metadata: { messageUid: "turn" },
})
const eventBlock = (timestamp: string, ...parts: MessagePart[]): MessageBlock => ({
  id: `event-${parts[0]!.messageUid}`, role: "assistant", timestamp, parts,
})
const queued = (uid: string, remoteState: QueuedMessage["remoteState"], extra: Partial<QueuedMessage> = {}): QueuedMessage => ({
  id: `client-${uid}`, remoteId: `q-${uid}`, text: "<nova-event>", messageUid: uid, remoteState, appearance: "queue", createdAt: T0, ...extra,
})

test("a waiting event isn't in the conversation, and the turn around it is untouched", () => {
  const before = text("turn", T0)
  const after = text("turn:segment:1", T2)
  const part = eventPart("note")
  for (const state of ["pending", "delivering", "failed"] as const) {
    const placed = placeQueuedEvents([before, eventBlock(T1, part), after], [queued("note", state)], true)
    assert.deepEqual(placed.messages.map(block => block.id), ["turn", "turn:segment:1"], state)
    assert.equal(placed.waiting.get("client-note"), part, state)
    assert.equal(placed.placedUids.has("note"), false, state)
  }
})

test("only the waiting member leaves a merged group, with every other part's identity kept", () => {
  const placed = placeQueuedEvents(
    [eventBlock(T1, eventPart("settled"), eventPart("waiting"), { type: "tool_use", toolName: "Read", content: "" })],
    [queued("waiting", "pending")], true)
  assert.deepEqual(placed.messages[0]!.parts.map(part => part.messageUid ?? part.toolName), ["settled", "Read"])
  assert.equal(placed.messages[0]!.timestamp, T1)
  assert.equal(placed.waiting.size, 1)
})

test("nothing is hidden because its state is unknown: no queue item, or no remote state, stays put", () => {
  const messages = [text("turn", T0), eventBlock(T1, eventPart("record-only"))]
  assert.equal(placeQueuedEvents(messages, [], true).messages, messages)
  assert.equal(placeQueuedEvents(messages, [queued("other", "pending")], true).messages, messages)
  assert.equal(placeQueuedEvents(messages, [queued("record-only", undefined)], true).messages, messages)
})

test("a placed event stays at its place whatever its queue item still says", () => {
  const messages = [eventBlock(T2, eventPart("note", true)), text("turn", T2)]
  for (const state of ["pending", "delivering", "delivered", "failed"] as const) {
    const placed = placeQueuedEvents(messages, [queued("note", state)], true)
    assert.equal(placed.messages, messages, state)
    assert.equal(placed.waiting.size, 0, state)
    assert.equal(placed.placedUids.has("note"), true, state)
  }
})

test("delivered with no record yet waits while the turn runs, so it moves once", () => {
  const item = queued("note", "delivered", { delivery: "steer-current", deliveredAt: T1, timelineAt: T1 })
  const placed = placeQueuedEvents([text("turn", T0), eventBlock(T0, eventPart("note"))], [item], true)
  assert.deepEqual(placed.messages.map(block => block.id), ["turn"])
  assert.equal(placed.waiting.has(item.id), true)
  assert.equal(placed.placedUids.has("note"), false)
  assert.equal(queuedMessageStatusLabel(item, true), "Sending into this turn")
  assert.equal(queuedMessageStatusLabel({ ...item, delivery: "after-current" }, true), "Delivering update")
  assert.equal(queuedMessageStatusLabel({ ...item, delivery: "after-current", steerUnavailable: true }, true), "Delivering update")
})

test("delivered with no record once the turn ended goes inline at its delivery time, never lost", () => {
  const item = queued("note", "delivered", { deliveredAt: T1, timelineAt: T1 })
  const placed = placeQueuedEvents([text("first", T0), eventBlock(T0, eventPart("note")), text("later", T2)], [item], false)
  assert.deepEqual(placed.messages.map(block => block.id), ["first", "event-note", "later"])
  assert.equal(placed.messages[1]!.timestamp, T1)
  assert.equal(placed.waiting.size, 0)
})

test("the audit's queue copy stays gone: a waiting or delivered projected event never also draws a ghost", () => {
  const messages = [eventBlock(T1, eventPart("note"))]
  const canonical = canonicalUserMessageUids(messages)
  for (const state of ["pending", "delivering", "delivered"] as const)
    assert.equal(isVisibleOutgoingMessage(queued("note", state), canonical), false, state)
})

test("the delivered receipt settles only once its record has placed it", () => {
  const item = queued("note", "delivered", { deliveredAt: T1, timelineAt: T1 })
  assert.equal(placeQueuedEvents([eventBlock(T0, eventPart("note"))], [item], true).placedUids.has("note"), false)
  assert.equal(placeQueuedEvents([eventBlock(T2, eventPart("note", true))], [item], true).placedUids.has("note"), true)
  const person: MessageBlock = { id: "typed", role: "user", timestamp: T2, parts: [{ type: "text", content: "hi" }], inputMessageUids: ["typed", "also"] }
  const uids = placeQueuedEvents([person], [], true).placedUids
  assert.equal(uids.has("typed") && uids.has("also"), true)
})

test("every member of a delivering batch finds its own queue item, and the head's uid still finds one", () => {
  const items = ["a", "b"].map(uid => queued(uid, "delivering", { deliveredMessageUid: "a" }))
  const byUid = queuedItemsByInputUid(items)
  assert.equal(byUid.get("a")?.id, "client-a")
  assert.equal(byUid.get("b")?.id, "client-b")
  assert.equal(queuedItemsByInputUid([queued("b", "delivered", { messageUid: undefined, deliveredMessageUid: "a" })]).get("a")?.id, "client-b")
})

test("a batch's members each wait under their own uid", () => {
  const members = ["a", "b", "c"]
  const placed = placeQueuedEvents(
    [eventBlock(T1, ...members.map(uid => eventPart(uid)))],
    members.map(uid => queued(uid, "delivering", { deliveredMessageUid: "a" })), true)
  assert.deepEqual([...placed.waiting.keys()], ["client-a", "client-b", "client-c"])
  assert.equal(placed.messages.length, 0)
})
