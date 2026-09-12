import type { PersistedMessage } from "./rebuild-blocks"

export type DurableTranscriptRequestId = string | number

/**
 * One server-authored storage-keyset page of immutable persisted transcript
 * records. Cursor values are opaque to this package and its consumers.
 * Sequence ranges describe canonical coverage; storage order may contain
 * inversions when concurrent writers persist already-sequenced events.
 */
export interface PersistedTranscriptPage {
  epoch: string | null
  records: PersistedMessage[]
  oldestCursor: string | null
  newestCursor: string | null
  hasEarlier: boolean
  hasLater: boolean
  fromSequence: number | null
  throughSequence: number | null
  /** The server completed every messageUid touching either page boundary. */
  boundaryComplete: boolean
}

export interface DurableTranscriptPagerState {
  epoch: string | null
  records: PersistedMessage[]
  oldestCursor: string | null
  newestCursor: string | null
  hasEarlier: boolean
  hasLater: boolean
  fromSequence: number | null
  throughSequence: number | null
  loadedRecordCount: number
}

export type DurableTranscriptPageRejection =
  | "stale-request"
  | "stale-anchor"
  | "stale-epoch"
  | "incomplete-boundary"
  | "invalid-page"

export interface DurableTranscriptPagerResult extends DurableTranscriptPagerState {
  accepted: boolean
  rejection?: DurableTranscriptPageRejection
}

interface ValidatedPage {
  records: PersistedMessage[]
  fromSequence: number | null
  throughSequence: number | null
}

/**
 * Accumulates storage-keyset-paged durable transcript records without applying
 * product projection or canonical ordering. Newest refreshes retain an already loaded prefix;
 * older/newer pages are accepted only against the anchor that requested them.
 *
 * This deliberately lives beside TranscriptAccumulator. Complete snapshots
 * keep their authoritative replacement semantics there; consumers of this
 * pager can rebuild the accepted loaded record window and pass it through the
 * existing snapshot/live reconciler.
 */
export class DurableTranscriptPager {
  private records: PersistedMessage[] = []
  private epoch: string | null = null
  private oldestCursor: string | null = null
  private newestCursor: string | null = null
  private hasEarlier = false
  private hasLater = false
  private fromSequence: number | null = null
  private throughSequence: number | null = null
  private initialized = false
  private oldestEdgeEstablished = false
  private latestNewestRequestId: DurableTranscriptRequestId | null = null
  private latestOlderRequestId: DurableTranscriptRequestId | null = null
  private latestNewerRequestId: DurableTranscriptRequestId | null = null

  startNewestPage(requestId: DurableTranscriptRequestId): void {
    this.latestNewestRequestId = requestId
  }

  /** Captures the exclusive anchor the caller must echo when committing. */
  startOlderPage(requestId: DurableTranscriptRequestId): string | null {
    this.latestOlderRequestId = requestId
    return this.oldestCursor
  }

  /** Captures the exclusive anchor the caller must echo when committing. */
  startNewerPage(requestId: DurableTranscriptRequestId): string | null {
    this.latestNewerRequestId = requestId
    return this.newestCursor
  }

  commitNewestPage(
    requestId: DurableTranscriptRequestId,
    page: PersistedTranscriptPage,
  ): DurableTranscriptPagerResult {
    if (this.latestNewestRequestId !== requestId)
      return this.reject("stale-request")

    const validated = validatePage(page)
    if (typeof validated === "string") return this.reject(validated)

    if (!this.initialized || this.epoch !== page.epoch) {
      this.installPage(page, validated)
      return this.accept()
    }

    this.records = mergeRecords(this.records, validated.records, page.epoch)
    if (!this.oldestEdgeEstablished && (validated.records.length > 0 || page.oldestCursor !== null)) {
      this.oldestCursor = page.oldestCursor
      this.hasEarlier = page.hasEarlier
      this.oldestEdgeEstablished = true
    }
    this.newestCursor = page.newestCursor ?? this.newestCursor
    this.hasLater = page.hasLater
    this.updateSequenceRange()
    return this.accept()
  }

  prependOlderPage(
    requestId: DurableTranscriptRequestId,
    expectedOldestCursor: string | null,
    page: PersistedTranscriptPage,
  ): DurableTranscriptPagerResult {
    return this.commitAnchoredPage("older", requestId, expectedOldestCursor, page)
  }

  appendNewerPage(
    requestId: DurableTranscriptRequestId,
    expectedNewestCursor: string | null,
    page: PersistedTranscriptPage,
  ): DurableTranscriptPagerResult {
    return this.commitAnchoredPage("newer", requestId, expectedNewestCursor, page)
  }

  reset(epoch: string | null = null): DurableTranscriptPagerState {
    this.records = []
    this.epoch = epoch
    this.oldestCursor = null
    this.newestCursor = null
    this.hasEarlier = false
    this.hasLater = false
    this.fromSequence = null
    this.throughSequence = null
    this.initialized = false
    this.oldestEdgeEstablished = false
    this.latestNewestRequestId = null
    this.latestOlderRequestId = null
    this.latestNewerRequestId = null
    return this.current()
  }

  current(): DurableTranscriptPagerState {
    return {
      epoch: this.epoch,
      records: [...this.records],
      oldestCursor: this.oldestCursor,
      newestCursor: this.newestCursor,
      hasEarlier: this.hasEarlier,
      hasLater: this.hasLater,
      fromSequence: this.fromSequence,
      throughSequence: this.throughSequence,
      loadedRecordCount: this.records.length,
    }
  }

  private commitAnchoredPage(
    direction: "older" | "newer",
    requestId: DurableTranscriptRequestId,
    expectedCursor: string | null,
    page: PersistedTranscriptPage,
  ): DurableTranscriptPagerResult {
    const latestRequestId = direction === "older"
      ? this.latestOlderRequestId
      : this.latestNewerRequestId
    if (latestRequestId !== requestId) return this.reject("stale-request")
    if (!this.initialized) return this.reject("stale-anchor")
    if (page.epoch !== this.epoch) return this.reject("stale-epoch")

    const currentCursor = direction === "older" ? this.oldestCursor : this.newestCursor
    if (expectedCursor === null || expectedCursor !== currentCursor)
      return this.reject("stale-anchor")

    const validated = validatePage(page)
    if (typeof validated === "string") return this.reject(validated)

    if (direction === "older") {
      if (page.oldestCursor === expectedCursor)
        return this.reject("invalid-page")
      this.records = mergeRecords(validated.records, this.records, page.epoch)
      if (page.oldestCursor !== null)
        this.oldestCursor = page.oldestCursor
      this.hasEarlier = page.hasEarlier
    }
    else {
      const isTerminalNoOp = validated.records.length === 0
        && page.hasLater === false
        && page.newestCursor === expectedCursor
      if (page.newestCursor === expectedCursor && !isTerminalNoOp)
        return this.reject("invalid-page")
      this.records = mergeRecords(this.records, validated.records, page.epoch)
      if (page.newestCursor !== null)
        this.newestCursor = page.newestCursor
      this.hasLater = page.hasLater
    }

    this.updateSequenceRange()
    return this.accept()
  }

  private installPage(page: PersistedTranscriptPage, validated: ValidatedPage): void {
    this.records = validated.records
    this.epoch = page.epoch
    this.oldestCursor = page.oldestCursor
    this.newestCursor = page.newestCursor
    this.hasEarlier = page.hasEarlier
    this.hasLater = page.hasLater
    this.fromSequence = validated.fromSequence
    this.throughSequence = validated.throughSequence
    this.initialized = true
    this.oldestEdgeEstablished = validated.records.length > 0 || page.oldestCursor !== null
    this.latestOlderRequestId = null
    this.latestNewerRequestId = null
  }

  private updateSequenceRange(): void {
    const range = sequenceRange(this.records)
    this.fromSequence = range.fromSequence
    this.throughSequence = range.throughSequence
  }

  private accept(): DurableTranscriptPagerResult {
    return { ...this.current(), accepted: true }
  }

  private reject(rejection: DurableTranscriptPageRejection): DurableTranscriptPagerResult {
    return { ...this.current(), accepted: false, rejection }
  }
}

function validatePage(
  page: PersistedTranscriptPage,
): ValidatedPage | Extract<DurableTranscriptPageRejection, "incomplete-boundary" | "invalid-page"> {
  if (page.boundaryComplete !== true) return "incomplete-boundary"
  if (page.epoch !== null && (typeof page.epoch !== "string" || page.epoch.length === 0))
    return "invalid-page"
  if (!Array.isArray(page.records)) return "invalid-page"
  if (!validCursor(page.oldestCursor) || !validCursor(page.newestCursor))
    return "invalid-page"
  if (typeof page.hasEarlier !== "boolean" || typeof page.hasLater !== "boolean")
    return "invalid-page"
  if (page.records.length > 0 && (!page.oldestCursor || !page.newestCursor))
    return "invalid-page"
  if (page.hasEarlier && !page.oldestCursor) return "invalid-page"
  if (page.hasLater && !page.newestCursor) return "invalid-page"

  const seen = new Set<string>()
  const records: PersistedMessage[] = []
  for (const record of page.records) {
    const identity = persistedRecordIdentity(record, page.epoch)
    if (!identity) return "invalid-page"
    if (seen.has(identity)) continue
    seen.add(identity)
    records.push(record)
  }

  const { fromSequence, throughSequence } = sequenceRange(records)
  if (page.fromSequence !== fromSequence || page.throughSequence !== throughSequence)
    return "invalid-page"

  return { records, fromSequence, throughSequence }
}

function validCursor(cursor: string | null): boolean {
  return cursor === null || (typeof cursor === "string" && cursor.length > 0)
}

function sequenceRange(records: PersistedMessage[]): {
  fromSequence: number | null
  throughSequence: number | null
} {
  let fromSequence: number | null = null
  let throughSequence: number | null = null
  for (const record of records) {
    if (record.sequence == null) continue
    fromSequence = fromSequence === null
      ? record.sequence
      : Math.min(fromSequence, record.sequence)
    throughSequence = throughSequence === null
      ? record.sequence
      : Math.max(throughSequence, record.sequence)
  }
  return { fromSequence, throughSequence }
}

function mergeRecords(
  earlier: PersistedMessage[],
  later: PersistedMessage[],
  epoch: string | null,
): PersistedMessage[] {
  const positions = new Map<string, number>()
  const merged: PersistedMessage[] = []
  for (const record of [...earlier, ...later]) {
    const identity = persistedRecordIdentity(record, epoch)
    // Every record was validated before reaching this point.
    if (!identity) continue
    const position = positions.get(identity)
    if (position === undefined) {
      positions.set(identity, merged.length)
      merged.push(record)
    }
    else {
      merged[position] = record
    }
  }
  return merged
}

function persistedRecordIdentity(record: PersistedMessage, pageEpoch: string | null): string | null {
  if (record.sequence != null) {
    if (!Number.isSafeInteger(record.sequence) || record.sequence < 0)
      return null
    if (!record.epoch || record.epoch !== pageEpoch)
      return null
    return `sequence:${record.epoch}:${record.sequence}`
  }

  if (typeof record.id === "number") {
    if (!Number.isSafeInteger(record.id)) return null
    return `legacy:number:${record.id}`
  }
  if (typeof record.id !== "string" || record.id.length === 0) return null
  return `legacy:string:${record.id}`
}
