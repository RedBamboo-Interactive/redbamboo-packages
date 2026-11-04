import assert from "node:assert/strict"
import { describe, it } from "node:test"
import type { ChatEvent, MessageBlock } from "../types"
import {
  canOfferRollback,
  hasErrorPart,
  isRewindableMessage,
  mergeRestoredDraft,
  REWIND_LABEL,
  restoredDraftText,
  rollbackMessageEntries,
  rollbackTargetBefore,
  TRANSCRIPT_RESET_EVENT,
  type RollbackIdleState,
} from "./conversation-rollback.ts"
import { processStreamEvent } from "./process-stream-event.ts"
import { DurableTranscriptPager } from "./durable-transcript-pager.ts"
import { TranscriptAccumulator } from "./transcript-accumulator.ts"

const IDLE: RollbackIdleState = {
  supported: true,
  disabled: false,
  isStreaming: false,
  interrupting: false,
  resumePending: false,
  questionPending: false,
  queuedCount: 0,
  runningBackgroundTaskCount: 0,
}

const user = (id: string, content = id): MessageBlock => ({
  id,
  role: "user",
  parts: [{ id: `${id}-p`, type: "text", content }],
} as unknown as MessageBlock)

const assistant = (id: string, type = "text", content = id): MessageBlock => ({
  id,
  role: "assistant",
  parts: [{ id: `${id}-p`, type, content }],
} as unknown as MessageBlock)

const ids = (messages: MessageBlock[]) => messages.map(message => message.id)

const live = (type: string, epoch: string, sequence: number, extra: Partial<ChatEvent> = {}): ChatEvent => ({
  type, content: type === "text" ? `s${sequence}` : null, epoch, sequence, messageUid: `m${sequence}`, ...extra,
} as ChatEvent)

const reset = (epoch: string, sequence: number): ChatEvent =>
  live(TRANSCRIPT_RESET_EVENT, epoch, sequence, { messageUid: "removed" })

describe("offering a rewind", () => {
  it("offers it only when supported and idle, for every reason the server would refuse", () => {
    assert.equal(canOfferRollback(IDLE), true)
    for (const not of [
      { supported: false },
      { disabled: true },
      { isStreaming: true },
      { interrupting: true },
      { resumePending: true },
      { questionPending: true },
      { queuedCount: 1 },
      { runningBackgroundTaskCount: 1 },
    ] satisfies Partial<RollbackIdleState>[])
      assert.equal(canOfferRollback({ ...IDLE, ...not }), false, JSON.stringify(not))
  })

  it("puts the action on a person's message, in words, and nowhere else", () => {
    let opened: string | null = null
    const [entry] = rollbackMessageEntries(user("u1"), true, uid => { opened = uid })
    assert.equal(entry.label, REWIND_LABEL)
    ;(entry as { run: () => void }).run()
    assert.equal(opened, "u1")

    assert.deepEqual(rollbackMessageEntries(user("u1"), false, () => {}), [])
    assert.deepEqual(rollbackMessageEntries(assistant("a1"), true, () => {}), [])
  })

  it("does not treat a machine event or a task notification as the person's message", () => {
    assert.equal(isRewindableMessage(user("u1", "hello")), true)
    assert.equal(isRewindableMessage(user("e1", '<nova-event type="mail">x</nova-event>')), false)
    assert.equal(isRewindableMessage(user("t1", "<task-notification>done</task-notification>")), false)
  })

  it("sends a refusal row back to the person's message that led to it, past machine events", () => {
    const messages = [
      user("u1"),
      assistant("a1"),
      user("u2"),
      user("e1", '<nova-event type="mail">x</nova-event>'),
      assistant("refused", "error", "API Error: refused"),
    ]

    assert.equal(hasErrorPart(messages[4]), true)
    assert.equal(hasErrorPart(messages[1]), false)
    assert.equal(rollbackTargetBefore(messages, 4), "u2")
  })

  it("offers nothing for an error with no message of the person's before it", () => {
    assert.equal(rollbackTargetBefore([assistant("boot", "error")], 0), null)
  })
})

describe("the removed text", () => {
  it("returns to the composer as the person wrote it", () => {
    assert.equal(restoredDraftText('<nova-context a="b">secret</nova-context>\nwhat I wrote'), "what I wrote")
    assert.equal(restoredDraftText(null), "")
  })

  it("never overwrites what is being typed", () => {
    assert.equal(mergeRestoredDraft("restored", ""), "restored")
    assert.equal(mergeRestoredDraft("restored", "typing"), "restored\n\ntyping")
    assert.equal(mergeRestoredDraft("", "typing"), "typing")
  })
})

describe("the reset event", () => {
  it("moves no turn state, because a host passes isStreaming=true", () => {
    const result = processStreamEvent([assistant("a1")], true, reset("e2", 9))

    assert.equal(result.background, true)
    assert.deepEqual(ids(result.messages), ["a1"])
  })

  it("asks for a snapshot and refuses the one already in flight", () => {
    const transcript = new TranscriptAccumulator()
    transcript.startSnapshot(1)
    transcript.commitSnapshot(1, [user("u1"), user("u2")], { epoch: "e1", throughSequence: 5 })
    transcript.startSnapshot(2)

    const received = transcript.receiveLive(reset("e2", 6))
    assert.equal(received.gapDetected, true)
    // Nothing flashes empty while the reload runs.
    assert.deepEqual(ids(received.messages), ["u1", "u2"])

    // Read before the rollback, so it still holds the removed turn.
    const stale = transcript.commitSnapshot(2, [user("u1"), user("u2")], { epoch: "e1", throughSequence: 5 })
    assert.equal(stale.staleSnapshot, true)

    transcript.startSnapshot(3)
    const fresh = transcript.commitSnapshot(3, [user("u1")], { epoch: "e2", throughSequence: 6 })
    assert.equal(fresh.staleSnapshot, undefined)
    assert.deepEqual(ids(fresh.messages), ["u1"])
  })

  it("is the same reset however often it arrives", () => {
    const transcript = new TranscriptAccumulator()
    transcript.startSnapshot(1)
    transcript.commitSnapshot(1, [user("u1")], { epoch: "e1", throughSequence: 5 })

    assert.equal(transcript.receiveLive(reset("e2", 6)).gapDetected, true)
    transcript.startSnapshot(2)
    transcript.commitSnapshot(2, [user("u1")], { epoch: "e2", throughSequence: 6 })
    assert.equal(transcript.receiveLive(reset("e2", 6)).gapDetected, false)
  })

  it("does not replay a retained event of the removed turn over the fresh snapshot", () => {
    const transcript = new TranscriptAccumulator()
    transcript.startSnapshot(1)
    transcript.commitSnapshot(1, [user("u1")], { epoch: "e1", throughSequence: 2 })
    transcript.receiveLive(live("text", "e1", 3))
    transcript.receiveLive(reset("e2", 4))

    transcript.startSnapshot(2)
    const fresh = transcript.commitSnapshot(2, [user("u1")], { epoch: "e2", throughSequence: 4 })

    assert.deepEqual(ids(fresh.messages), ["u1"])
  })
})

// The regression matrix of the chat-stability skill, for a rollback.
describe("rollback regression matrix", () => {
  const snapshot = (transcript: TranscriptAccumulator, id: number, messages: MessageBlock[], epoch: string, through: number) => {
    transcript.startSnapshot(id)
    return transcript.commitSnapshot(id, messages, { epoch, throughSequence: through })
  }

  it("history/live overlap: a next-message event already in the new snapshot does not double", () => {
    const transcript = new TranscriptAccumulator()
    snapshot(transcript, 1, [user("u1")], "e2", 6)
    transcript.startSnapshot(2)
    transcript.receiveLive(live("text", "e2", 7))
    const committed = transcript.commitSnapshot(2, [user("u1"), assistant("m7")], { epoch: "e2", throughSequence: 7 })

    assert.deepEqual(ids(committed.messages), ["u1", "m7"])
    assert.equal(transcript.receiveLive(live("text", "e2", 7)).gapDetected, false)
  })

  it("fresh mount: a client that never saw the old epoch reads the new one with no gap", () => {
    const transcript = new TranscriptAccumulator()
    const mounted = snapshot(transcript, 1, [user("u1")], "e2", 6)

    assert.deepEqual(ids(mounted.messages), ["u1"])
    assert.equal(transcript.receiveLive(live("text", "e2", 7)).gapDetected, false)
  })

  it("fresh mount: the reset arriving before any snapshot still asks for one", () => {
    const transcript = new TranscriptAccumulator()

    assert.equal(transcript.receiveLive(reset("e2", 6)).gapDetected, true)
  })

  it("reopen and switching: a new accumulator agrees with the old one", () => {
    const old = new TranscriptAccumulator()
    snapshot(old, 1, [user("u1"), user("u2")], "e1", 5)
    old.receiveLive(reset("e2", 6))
    const reopened = new TranscriptAccumulator()

    assert.deepEqual(
      ids(snapshot(old, 2, [user("u1")], "e2", 6).messages),
      ids(snapshot(reopened, 1, [user("u1")], "e2", 6).messages),
    )
  })

  it("reconnect: a client that missed the reset learns from the next event's epoch", () => {
    const transcript = new TranscriptAccumulator()
    snapshot(transcript, 1, [user("u1"), user("u2")], "e1", 5)

    const next = transcript.receiveLive(live("text", "e2", 8))

    assert.equal(next.gapDetected, true)
    const repaired = snapshot(transcript, 2, [user("u1"), assistant("m8")], "e2", 8)
    assert.deepEqual(ids(repaired.messages), ["u1", "m8"])
  })

  it("reconnect: a snapshot alone repairs a client that missed everything", () => {
    const transcript = new TranscriptAccumulator()
    snapshot(transcript, 1, [user("u1"), user("u2")], "e1", 5)

    const repaired = snapshot(transcript, 2, [user("u1")], "e2", 6)

    assert.deepEqual(ids(repaired.messages), ["u1"])
    assert.equal(transcript.receiveLive(live("text", "e2", 7)).gapDetected, false)
  })

  it("pagination: older pages of the old epoch are refused, so a host recovers with a newest page", () => {
    const pager = new DurableTranscriptPager()
    const page = (epoch: string, from: number, through: number) => ({
      epoch,
      records: Array.from({ length: through - from + 1 }, (_, i) => ({
        id: from + i, role: "user", eventType: "text", content: "x", messageUid: `u${from + i}`,
        timestamp: new Date(from + i).toISOString(), epoch, sequence: from + i,
      })),
      oldestCursor: `o${from}`,
      newestCursor: `n${through}`,
      hasEarlier: true,
      hasLater: false,
      fromSequence: from,
      throughSequence: through,
      boundaryComplete: true,
    })
    pager.startNewestPage(1)
    assert.equal(pager.commitNewestPage(1, page("e1", 3, 5)).accepted, true)

    const anchor = pager.startOlderPage(2)
    assert.equal(pager.prependOlderPage(2, anchor, page("e2", 1, 2)).rejection, "stale-epoch")

    pager.reset()
    pager.startNewestPage(3)
    assert.equal(pager.commitNewestPage(3, page("e2", 1, 2)).accepted, true)
    assert.equal(pager.current().epoch, "e2")
  })

  it("streaming turn: live events of the next message project over the kept history", () => {
    const transcript = new TranscriptAccumulator()
    snapshot(transcript, 1, [user("u1")], "e2", 6)

    const first = transcript.receiveLive(live("text", "e2", 7))
    const second = transcript.receiveLive(live("text", "e2", 8, { messageUid: "m7" }))

    assert.equal(first.gapDetected, false)
    assert.equal(second.gapDetected, false)
    assert.equal(second.messages[0].id, "u1")
    assert.equal(second.messages.length, 2)
  })

  it("pagination: a page holding only what was kept verifies, and the next event is not a gap", () => {
    // Kept records end at sequence 2; the rollback consumed 6. The page says 2, because the pager
    // checks that against its records; the accumulator knows about 6 from the reset.
    const transcript = new TranscriptAccumulator()
    snapshot(transcript, 1, [user("u1"), user("u2")], "e1", 5)
    transcript.receiveLive(reset("e2", 6))

    snapshot(transcript, 2, [user("u1")], "e2", 2)

    assert.equal(transcript.receiveLive(live("text", "e2", 7)).gapDetected, false)
  })

  it("does not replay a retained event over a snapshot with no cursor", () => {
    const transcript = new TranscriptAccumulator()
    snapshot(transcript, 1, [user("u1")], "e1", 5)
    transcript.receiveLive(live("text", "e1", 6))
    transcript.receiveLive(reset("e2", 7))

    transcript.startSnapshot(2)
    assert.deepEqual(ids(transcript.commitSnapshot(2, [user("u1")], null).messages), ["u1"])
  })

  it("says once that a snapshot is the first of a new epoch, however the client learned of it", () => {
    const fromEvent = new TranscriptAccumulator()
    snapshot(fromEvent, 1, [user("u1")], "e1", 5)
    fromEvent.receiveLive(reset("e2", 6))
    assert.equal(snapshot(fromEvent, 2, [user("u1")], "e2", 6).epochChanged, true)
    assert.equal(snapshot(fromEvent, 3, [user("u1")], "e2", 6).epochChanged, false)

    const missedIt = new TranscriptAccumulator()
    snapshot(missedIt, 1, [user("u1")], "e1", 5)
    assert.equal(snapshot(missedIt, 2, [user("u1")], "e2", 6).epochChanged, true)

    const nextEvent = new TranscriptAccumulator()
    snapshot(nextEvent, 1, [user("u1")], "e1", 5)
    nextEvent.receiveLive(live("text", "e2", 7))
    assert.equal(snapshot(nextEvent, 2, [user("u1")], "e2", 7).epochChanged, true)

    const fresh = new TranscriptAccumulator()
    assert.equal(snapshot(fresh, 1, [user("u1")], "e2", 6).epochChanged, false)
  })

  it("settled turn: nothing of the removed turn survives a settled reload", () => {
    const transcript = new TranscriptAccumulator()
    snapshot(transcript, 1, [user("u1"), assistant("a1"), user("u2"), assistant("a2")], "e1", 9)
    transcript.receiveLive(reset("e2", 10))

    const settled = snapshot(transcript, 2, [user("u1"), assistant("a1")], "e2", 10)

    assert.deepEqual(ids(settled.messages), ["u1", "a1"])
  })
})
