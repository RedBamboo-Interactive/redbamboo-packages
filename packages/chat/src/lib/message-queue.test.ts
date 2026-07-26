import { test } from "node:test"
import assert from "node:assert/strict"
import { enqueue, cancel, coalesce, shouldDrain, drainStep, type QueuedMessage } from "./message-queue.ts"

const msg = (id: string, text: string, images?: QueuedMessage["images"]): QueuedMessage => ({ id, text, images })

test("enqueue appends without mutating the input array", () => {
  const before: QueuedMessage[] = [msg("a", "one")]
  const after = enqueue(before, msg("b", "two"))
  assert.equal(before.length, 1, "original queue left untouched")
  assert.deepEqual(after.map(m => m.id), ["a", "b"])
})

test("cancel removes only the matching entry", () => {
  const queue = [msg("a", "one"), msg("b", "two"), msg("c", "three")]
  assert.deepEqual(cancel(queue, "b").map(m => m.id), ["a", "c"])
  assert.deepEqual(cancel(queue, "missing").map(m => m.id), ["a", "b", "c"], "unknown id is a no-op")
})

test("coalesce joins multiple queued entries into one turn", () => {
  const queue = [
    msg("a", "first thought", [{ mediaType: "image/png", base64: "AAA" }]),
    msg("b", "second thought"),
    msg("c", "third thought", [{ mediaType: "image/png", base64: "BBB" }]),
  ]
  const result = coalesce(queue)
  assert.equal(result?.text, "first thought\nsecond thought\nthird thought")
  assert.deepEqual(result?.images?.map(i => i.base64), ["AAA", "BBB"], "images merged in order")
})

test("coalesce on an empty queue is null, not an empty send", () => {
  assert.equal(coalesce([]), null)
})

test("coalesce omits the images field when nothing has attachments", () => {
  const result = coalesce([msg("a", "hello")])
  assert.equal(result?.images, undefined)
})

/** Everything clear: the queue would drain. Each test vetoes one condition. */
const clear = { queueLength: 1, isStreaming: false, disabled: false }

test("shouldDrain requires a non-empty queue, no active stream, and an enabled session", () => {
  assert.equal(shouldDrain(clear), true, "idle with something queued drains")
  assert.equal(shouldDrain({ ...clear, queueLength: 0 }), false, "nothing queued")
  assert.equal(shouldDrain({ ...clear, isStreaming: true }), false, "still streaming — stays queued")
  assert.equal(shouldDrain({ ...clear, disabled: true }), false, "disabled session — stays queued, never dropped")
})

test("shouldDrain refuses to write while a killed process is being resumed", () => {
  // isStreaming is already false here — "killed" is a terminal status — but
  // writing would race the backend's resume. See process-stream-event.ts.
  assert.equal(shouldDrain({ ...clear, resumePending: true }), false, "resumePending blocks the drain")
  assert.equal(shouldDrain({ ...clear, resumePending: false }), true, "once the resume lands, draining resumes")
})

test("shouldDrain holds while the agent is blocked on a question", () => {
  // isStreaming is forced false so the answer box works, but the turn is still
  // open server-side and answers go through onAnswerQuestion, not the queue.
  // Draining here would post a plain message into a turn awaiting an answer.
  assert.equal(shouldDrain({ ...clear, questionPending: true }), false, "question pending blocks the drain")
  assert.equal(shouldDrain({ ...clear, questionPending: false }), true, "answered — the queue moves again")
})

test("shouldDrain treats every blocker as an independent veto", () => {
  assert.equal(shouldDrain({ ...clear, resumePending: true, questionPending: true }), false)
  assert.equal(shouldDrain({ ...clear, isStreaming: true, disabled: true }), false)
})

test("drainStep empties the queue and hands back one coalesced send", () => {
  const queue = [msg("a", "hello"), msg("b", "world")]
  const result = drainStep(queue)
  assert.equal(result?.sent.text, "hello\nworld")
  assert.deepEqual(result?.remaining, [])
})

test("drainStep is a no-op on an already-drained queue — guards against firing twice", () => {
  const queue = [msg("a", "hello")]
  const first = drainStep(queue)
  assert.ok(first)
  const second = drainStep(first!.remaining)
  assert.equal(second, null, "a stale duplicate drain call sends nothing")
})
