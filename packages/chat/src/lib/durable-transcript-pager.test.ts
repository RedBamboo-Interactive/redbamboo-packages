import assert from "node:assert/strict"
import test from "node:test"
import type { PersistedMessage } from "./rebuild-blocks.ts"
import { rebuildBlocks } from "./rebuild-blocks.ts"
import {
  DurableTranscriptPager,
  type PersistedTranscriptPage,
} from "./durable-transcript-pager.ts"

function record(
  sequence: number,
  epoch = "epoch-1",
  messageUid = `turn-${sequence}`,
): PersistedMessage {
  return {
    id: sequence,
    role: sequence % 2 === 0 ? "assistant" : "user",
    eventType: "text",
    content: `record-${sequence}`,
    messageUid,
    timestamp: new Date(Date.UTC(2026, 7, 23, 9, 0, sequence)).toISOString(),
    epoch,
    sequence,
  }
}

function page(
  records: PersistedMessage[],
  options: Partial<Omit<PersistedTranscriptPage, "records" | "fromSequence" | "throughSequence">> = {},
): PersistedTranscriptPage {
  const sequences = records
    .map(item => item.sequence)
    .filter((sequence): sequence is number => sequence != null)
  const firstId = records[0]?.id ?? null
  const lastId = records.at(-1)?.id ?? null
  return {
    epoch: "epoch-1",
    records,
    oldestCursor: firstId == null ? null : `cursor-${firstId}`,
    newestCursor: lastId == null ? null : `cursor-${lastId}`,
    hasEarlier: false,
    hasLater: false,
    fromSequence: sequences.length > 0 ? Math.min(...sequences) : null,
    throughSequence: sequences.length > 0 ? Math.max(...sequences) : null,
    boundaryComplete: true,
    ...options,
  }
}

test("newest refresh and 500 newer appends never drop the loaded prefix", () => {
  const pager = new DurableTranscriptPager()
  const initial = Array.from({ length: 500 }, (_, index) => record(index + 1))
  pager.startNewestPage("initial")
  assert.equal(pager.commitNewestPage("initial", page(initial, { hasEarlier: true })).accepted, true)

  // A rolling newest-500 refresh overlaps the prior page and omits record 1.
  pager.startNewestPage("rolling")
  pager.commitNewestPage("rolling", page(
    Array.from({ length: 500 }, (_, index) => record(index + 2)),
    { hasEarlier: true },
  ))
  assert.equal(pager.current().records[0].sequence, 1)
  assert.equal(pager.current().loadedRecordCount, 501)

  for (let sequence = 502; sequence <= 1001; sequence++) {
    const requestId = `newer-${sequence}`
    const anchor = pager.startNewerPage(requestId)
    const result = pager.appendNewerPage(
      requestId,
      anchor,
      page([record(sequence)], {
        oldestCursor: `cursor-${sequence}`,
        newestCursor: `cursor-${sequence}`,
      }),
    )
    assert.equal(result.accepted, true)
  }

  const current = pager.current()
  assert.equal(current.loadedRecordCount, 1001)
  assert.equal(current.records[0].sequence, 1)
  assert.equal(current.records.at(-1)?.sequence, 1001)
  assert.equal(current.fromSequence, 1)
  assert.equal(current.throughSequence, 1001)
  assert.equal(current.hasEarlier, true)
})

test("prepends overlapping older pages once and rejects a duplicate response without mutation", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage(1)
  pager.commitNewestPage(1, page(
    Array.from({ length: 500 }, (_, index) => record(index + 501)),
    { hasEarlier: true },
  ))

  const anchor = pager.startOlderPage(2)
  assert.equal(anchor, "cursor-501")
  const older = page(
    Array.from({ length: 501 }, (_, index) => record(index + 1)),
    { hasEarlier: false },
  )
  const accepted = pager.prependOlderPage(2, anchor, older)
  assert.equal(accepted.accepted, true)
  assert.equal(accepted.loadedRecordCount, 1000)
  assert.equal(accepted.hasEarlier, false)

  const duplicate = pager.prependOlderPage(2, anchor, older)
  assert.equal(duplicate.accepted, false)
  assert.equal(duplicate.rejection, "stale-anchor")
  assert.equal(duplicate.loadedRecordCount, 1000)
})

test("appends an overlapping newer page idempotently and advances only the newest edge", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(1), record(2), record(3)], {
    hasEarlier: true,
  }))

  const anchor = pager.startNewerPage("newer")
  const newer = page([record(3), record(4)], {
    oldestCursor: "cursor-3",
    newestCursor: "cursor-4",
    hasLater: false,
  })
  const accepted = pager.appendNewerPage("newer", anchor, newer)
  assert.equal(accepted.accepted, true)
  assert.deepEqual(accepted.records.map(item => item.sequence), [1, 2, 3, 4])
  assert.equal(accepted.oldestCursor, "cursor-1")
  assert.equal(accepted.newestCursor, "cursor-4")
  assert.equal(accepted.hasEarlier, true)

  const duplicate = pager.appendNewerPage("newer", anchor, newer)
  assert.equal(duplicate.rejection, "stale-anchor")
  assert.deepEqual(duplicate.records.map(item => item.sequence), [1, 2, 3, 4])
})

test("an overlay-only older page advances its outer cursor without canonical records", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(10)], { hasEarlier: true }))

  const anchor = pager.startOlderPage("overlay-only")
  const advanced = pager.prependOlderPage(
    "overlay-only",
    anchor,
    page([], { oldestCursor: "outer-older-1", hasEarlier: true }),
  )
  assert.equal(advanced.accepted, true)
  assert.equal(advanced.oldestCursor, "outer-older-1")
  assert.equal(advanced.hasEarlier, true)
  assert.deepEqual(advanced.records.map(item => item.sequence), [10])
  assert.equal(pager.startOlderPage("next-overlay-page"), "outer-older-1")

  const noProgress = pager.prependOlderPage(
    "next-overlay-page",
    "outer-older-1",
    page([], { oldestCursor: "outer-older-1", hasEarlier: true }),
  )
  assert.equal(noProgress.rejection, "invalid-page")
  assert.equal(noProgress.oldestCursor, "outer-older-1")
})

test("an overlay-only newer page advances its outer cursor without canonical records", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(10)], { hasLater: true }))

  const anchor = pager.startNewerPage("overlay-only")
  const advanced = pager.appendNewerPage(
    "overlay-only",
    anchor,
    page([], { newestCursor: "outer-newer-1", hasLater: true }),
  )
  assert.equal(advanced.accepted, true)
  assert.equal(advanced.newestCursor, "outer-newer-1")
  assert.equal(advanced.hasLater, true)
  assert.deepEqual(advanced.records.map(item => item.sequence), [10])
  assert.equal(pager.startNewerPage("next-overlay-page"), "outer-newer-1")

  const noProgress = pager.appendNewerPage(
    "next-overlay-page",
    "outer-newer-1",
    page([], { newestCursor: "outer-newer-1", hasLater: true }),
  )
  assert.equal(noProgress.rejection, "invalid-page")
  assert.equal(noProgress.newestCursor, "outer-newer-1")
})

test("accepts an unchanged newer anchor only as an empty terminal catch-up", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(10)], { hasLater: true }))

  const anchor = pager.startNewerPage("terminal")
  const terminal = pager.appendNewerPage(
    "terminal",
    anchor,
    page([], { newestCursor: anchor, hasLater: false }),
  )
  assert.equal(terminal.accepted, true)
  assert.equal(terminal.newestCursor, anchor)
  assert.equal(terminal.hasLater, false)
  assert.deepEqual(terminal.records.map(item => item.sequence), [10])
})

test("rejects an unchanged newer anchor when it claims records or more pages", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(10)], { hasLater: true }))

  const nonemptyAnchor = pager.startNewerPage("nonempty")
  const nonempty = pager.appendNewerPage(
    "nonempty",
    nonemptyAnchor,
    page([record(10)], { newestCursor: nonemptyAnchor, hasLater: false }),
  )
  assert.equal(nonempty.rejection, "invalid-page")
  assert.equal(nonempty.hasLater, true)

  const loopingAnchor = pager.startNewerPage("looping")
  const looping = pager.appendNewerPage(
    "looping",
    loopingAnchor,
    page([], { newestCursor: loopingAnchor, hasLater: true }),
  )
  assert.equal(looping.rejection, "invalid-page")
  assert.equal(looping.hasLater, true)
  assert.deepEqual(looping.records.map(item => item.sequence), [10])
})

test("rejects stale request ids independently for each direction", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(10)], { hasEarlier: true }))

  const olderAnchor = pager.startOlderPage("older-1")
  pager.startOlderPage("older-2")
  pager.startNewestPage("refresh")
  const staleOlder = pager.prependOlderPage(
    "older-1",
    olderAnchor,
    page([record(9)], { hasEarlier: true }),
  )
  assert.equal(staleOlder.rejection, "stale-request")

  // Committing a newest refresh did not cancel the latest older request or
  // move its oldest anchor.
  const refreshed = pager.commitNewestPage("refresh", page([record(10), record(11)], {
    hasEarlier: true,
  }))
  assert.equal(refreshed.accepted, true)
  const currentOlderAnchor = pager.current().oldestCursor
  const acceptedOlder = pager.prependOlderPage(
    "older-2",
    currentOlderAnchor,
    page([record(9)], { hasEarlier: false }),
  )
  assert.equal(acceptedOlder.accepted, true)

  pager.startNewestPage("refresh-2")
  const staleNewest = pager.commitNewestPage("refresh", page([record(11)]))
  assert.equal(staleNewest.rejection, "stale-request")
  assert.equal(staleNewest.loadedRecordCount, 3)
})

test("newest refresh preserves facts owned by an already extended oldest edge", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(2), record(3)], { hasEarlier: true }))
  const anchor = pager.startOlderPage("older")
  pager.prependOlderPage("older", anchor, page([record(1)], { hasEarlier: false }))

  pager.startNewestPage("refresh")
  const refreshed = pager.commitNewestPage(
    "refresh",
    page([record(2), record(3), record(4)], { hasEarlier: true }),
  )
  assert.equal(refreshed.accepted, true)
  assert.equal(refreshed.hasEarlier, false)
  assert.equal(refreshed.oldestCursor, "cursor-1")
  assert.deepEqual(refreshed.records.map(item => item.sequence), [1, 2, 3, 4])
})

test("first non-empty newest refresh initializes the oldest edge after an empty page", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("empty")
  const empty = pager.commitNewestPage("empty", page([]))
  assert.equal(empty.accepted, true)
  assert.equal(empty.loadedRecordCount, 0)
  assert.equal(empty.oldestCursor, null)

  pager.startNewestPage("first-record")
  const populated = pager.commitNewestPage(
    "first-record",
    page([record(1)], { hasEarlier: true }),
  )
  assert.equal(populated.accepted, true)
  assert.equal(populated.oldestCursor, "cursor-1")
  assert.equal(populated.newestCursor, "cursor-1")
  assert.equal(populated.hasEarlier, true)
})

test("canonical arrival preserves an oldest edge established by an overlay-only newest page", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("overlay-only")
  const overlayOnly = pager.commitNewestPage(
    "overlay-only",
    page([], {
      oldestCursor: "outer-oldest",
      newestCursor: "outer-newest",
      hasEarlier: true,
    }),
  )
  assert.equal(overlayOnly.accepted, true)
  assert.equal(overlayOnly.loadedRecordCount, 0)
  assert.equal(overlayOnly.oldestCursor, "outer-oldest")
  assert.equal(overlayOnly.hasEarlier, true)

  pager.startNewestPage("canonical-arrived")
  const canonical = pager.commitNewestPage(
    "canonical-arrived",
    page([record(10)], {
      oldestCursor: "canonical-page-oldest",
      newestCursor: "outer-newest-after-canonical",
      hasEarlier: false,
    }),
  )
  assert.equal(canonical.accepted, true)
  assert.equal(canonical.loadedRecordCount, 1)
  assert.equal(canonical.oldestCursor, "outer-oldest")
  assert.equal(canonical.hasEarlier, true)
  assert.equal(canonical.newestCursor, "outer-newest-after-canonical")
})

test("rejects a response requested from an obsolete anchor", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(5)], { hasEarlier: true }))
  pager.startOlderPage("older")

  const result = pager.prependOlderPage(
    "older",
    "cursor-obsolete",
    page([record(4)], { hasEarlier: false }),
  )
  assert.equal(result.rejection, "stale-anchor")
  assert.deepEqual(result.records.map(item => item.sequence), [5])
})

test("a newest page atomically resets a changed epoch and invalidates old anchored pages", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("epoch-1")
  pager.commitNewestPage("epoch-1", page([record(1)], { hasEarlier: true }))
  const oldNewestAnchor = pager.startNewerPage("catch-up-old")

  pager.startNewestPage("epoch-2")
  const changed = pager.commitNewestPage("epoch-2", page(
    [record(1, "epoch-2")],
    { epoch: "epoch-2", oldestCursor: "epoch-2-1", newestCursor: "epoch-2-1" },
  ))
  assert.equal(changed.accepted, true)
  assert.equal(changed.epoch, "epoch-2")
  assert.deepEqual(changed.records.map(item => item.content), ["record-1"])

  const stale = pager.appendNewerPage(
    "catch-up-old",
    oldNewestAnchor,
    page([record(2)], { newestCursor: "cursor-2" }),
  )
  assert.equal(stale.rejection, "stale-request")
  assert.equal(stale.epoch, "epoch-2")
  assert.equal(stale.loadedRecordCount, 1)
})

test("trusts explicit hasEarlier even when the accepted page fills its soft limit", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("exact")
  const result = pager.commitNewestPage(
    "exact",
    page(Array.from({ length: 500 }, (_, index) => record(index + 1)), { hasEarlier: false }),
  )
  assert.equal(result.accepted, true)
  assert.equal(result.loadedRecordCount, 500)
  assert.equal(result.hasEarlier, false)
})

test("requires the server's complete-messageUid boundary guarantee", () => {
  const records = [
    { ...record(1, "epoch-1", "one-turn"), role: "assistant" },
    { ...record(2, "epoch-1", "one-turn"), role: "assistant" },
  ]
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("incomplete")
  const incomplete = pager.commitNewestPage(
    "incomplete",
    page(records, { boundaryComplete: false }),
  )
  assert.equal(incomplete.rejection, "incomplete-boundary")
  assert.equal(incomplete.loadedRecordCount, 0)

  pager.startNewestPage("complete")
  const complete = pager.commitNewestPage("complete", page(records))
  assert.equal(complete.accepted, true)
  assert.equal(complete.loadedRecordCount, 2)
  const blocks = rebuildBlocks(complete.records)
  assert.equal(blocks.length, 1)
  assert.equal(blocks[0].id, "one-turn")
  assert.equal(blocks[0].parts.length, 1)
  assert.equal(blocks[0].parts[0].content, "record-1record-2")
})

test("uses typed legacy record ids without content or timestamp deduplication", () => {
  const base = {
    role: "assistant",
    eventType: "text",
    content: "same content",
    timestamp: "2026-08-23T09:00:00Z",
  }
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("legacy")
  const result = pager.commitNewestPage("legacy", page(
    [{ ...base, id: 1 }, { ...base, id: "1" }],
    { epoch: null, oldestCursor: "legacy-number", newestCursor: "legacy-string" },
  ))
  assert.equal(result.accepted, true)
  assert.equal(result.loadedRecordCount, 2)
  assert.deepEqual(result.records.map(item => item.id), [1, "1"])
})

test("rejects malformed sequence metadata without changing accepted state", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(1)]))

  pager.startNewestPage("bad-epoch")
  const badEpoch = pager.commitNewestPage(
    "bad-epoch",
    page([record(2, "other-epoch")]),
  )
  assert.equal(badEpoch.rejection, "invalid-page")
  assert.deepEqual(badEpoch.records.map(item => item.sequence), [1])

  pager.startNewestPage("bad-range")
  const badRange = pager.commitNewestPage(
    "bad-range",
    { ...page([record(2)]), throughSequence: 99 },
  )
  assert.equal(badRange.rejection, "invalid-page")
  assert.deepEqual(badRange.records.map(item => item.sequence), [1])
})

test("rejects a sequenced page that would move its requested edge backwards", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(10), record(11)]))

  pager.startNewestPage("stale-newest")
  const staleNewest = pager.commitNewestPage(
    "stale-newest",
    page([record(8), record(9)], { oldestCursor: "cursor-8", newestCursor: "cursor-9" }),
  )
  assert.equal(staleNewest.rejection, "invalid-page")
  assert.deepEqual(staleNewest.records.map(item => item.sequence), [10, 11])

  const olderAnchor = pager.startOlderPage("not-older")
  const notOlder = pager.prependOlderPage(
    "not-older",
    olderAnchor,
    page([record(12)], { oldestCursor: "cursor-12", newestCursor: "cursor-12" }),
  )
  assert.equal(notOlder.rejection, "invalid-page")
  assert.deepEqual(notOlder.records.map(item => item.sequence), [10, 11])
})

test("reset clears records, cursors, page facts, and pending request generations", () => {
  const pager = new DurableTranscriptPager()
  pager.startNewestPage("initial")
  pager.commitNewestPage("initial", page([record(1)], { hasEarlier: true, hasLater: true }))
  pager.startOlderPage("older")

  const reset = pager.reset("epoch-2")
  assert.equal(reset.epoch, "epoch-2")
  assert.equal(reset.loadedRecordCount, 0)
  assert.equal(reset.oldestCursor, null)
  assert.equal(reset.newestCursor, null)
  assert.equal(reset.hasEarlier, false)
  assert.equal(reset.hasLater, false)

  const stale = pager.prependOlderPage(
    "older",
    "cursor-1",
    page([record(0, "epoch-2")], { epoch: "epoch-2" }),
  )
  assert.equal(stale.rejection, "stale-request")
})
