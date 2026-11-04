import type { ChatEvent, MessageBlock } from "../types"
import { processStreamEvent } from "./process-stream-event.ts"
import { TRANSCRIPT_RESET_EVENT } from "./conversation-rollback.ts"

export interface TranscriptCursor {
  epoch: string
  throughSequence: number
}

export interface TranscriptAccumulatorResult {
  messages: MessageBlock[]
  gapDetected: boolean
  staleSnapshot?: boolean
  /** The first snapshot of a new epoch: whatever a host kept locally beside the old one predates it. */
  epochChanged?: boolean
}

export type TranscriptEventProjector = (
  messages: MessageBlock[],
  event: ChatEvent,
) => MessageBlock[]

const defaultProjector: TranscriptEventProjector = (messages, event) =>
  processStreamEvent(messages, true, event).messages

/**
 * Reconciles one authoritative history snapshot with the ordered live events
 * that the snapshot does not yet cover. Product clients own transport and
 * presentation; this class owns the snapshot/live race exactly once.
 */
export class TranscriptAccumulator {
  private readonly project: TranscriptEventProjector
  private messages: MessageBlock[] = []
  private epoch: string | null = null
  private watermark = 0
  private highestSequence = 0
  /** The rotation point of a reset: nothing at or below it can ever arrive in this epoch. */
  private resetSequence = 0
  private epochMoved = false
  private hasCursor = false
  private latestRequestId: string | number | null = null
  private readonly retained = new Map<number, ChatEvent>()
  private readonly legacySinceSnapshot: ChatEvent[] = []

  constructor(project: TranscriptEventProjector = defaultProjector) {
    this.project = project
  }

  startSnapshot(requestId: string | number): void {
    this.latestRequestId = requestId
  }

  receiveLive(event: ChatEvent, currentMessages?: MessageBlock[]): TranscriptAccumulatorResult {
    if (currentMessages) this.messages = currentMessages
    const epoch = event.epoch ?? null
    const sequence = event.sequence ?? null

    if (event.type === TRANSCRIPT_RESET_EVENT && epoch && sequence != null)
      return this.receiveReset(epoch, sequence)

    if (!epoch || sequence == null) {
      this.legacySinceSnapshot.push(event)
      this.messages = this.project(this.messages, event)
      return { messages: this.messages, gapDetected: false }
    }

    const epochChanged = this.epoch !== null && this.epoch !== epoch
    if (epochChanged) {
      this.reset(epoch)
      this.epochMoved = true
    } else if (this.epoch === null)
      this.epoch = epoch

    if (sequence <= this.watermark || this.retained.has(sequence))
      return { messages: this.messages, gapDetected: false }

    const gapDetected = epochChanged || (this.hasCursor && sequence > this.highestSequence + 1)
    this.highestSequence = Math.max(this.highestSequence, sequence)
    this.retained.set(sequence, event)
    this.messages = this.project(this.messages, event)
    return { messages: this.messages, gapDetected }
  }

  /**
   * A rollback moved the transcript to a new epoch. Nothing retained or in flight can still apply:
   * an earlier snapshot was read before it and is refused when it lands. What is on screen stays
   * until the snapshot this asks for replaces it, as any other authoritative snapshot does.
   */
  private receiveReset(epoch: string, sequence: number): TranscriptAccumulatorResult {
    if (this.epoch === epoch && sequence <= this.watermark)
      return { messages: this.messages, gapDetected: false }
    this.epoch = epoch
    this.epochMoved = true
    this.resetSequence = sequence
    this.watermark = sequence
    this.highestSequence = sequence
    this.hasCursor = true
    this.latestRequestId = null
    this.retained.clear()
    this.legacySinceSnapshot.length = 0
    return { messages: this.messages, gapDetected: true }
  }

  commitSnapshot(
    requestId: string | number,
    messages: MessageBlock[],
    cursor?: TranscriptCursor | null,
  ): TranscriptAccumulatorResult {
    if (this.latestRequestId !== requestId)
      return { messages: this.messages, gapDetected: false, staleSnapshot: true }

    if (!cursor) {
      this.messages = messages
      for (const [, event] of [...this.retained].sort(([a], [b]) => a - b))
        this.messages = this.project(this.messages, event)
      for (const event of this.legacySinceSnapshot)
        this.messages = this.project(this.messages, event)
      this.legacySinceSnapshot.length = 0
      return { messages: this.messages, gapDetected: false }
    }

    if (this.epoch !== cursor.epoch) {
      if (this.epoch !== null) this.epochMoved = true
      for (const [sequence, event] of this.retained)
        if (event.epoch !== cursor.epoch) this.retained.delete(sequence)
      this.epoch = cursor.epoch
      this.resetSequence = 0
    }

    this.messages = messages
    // A page's range describes its records, and what was kept is below the rotation. The next event
    // follows the rotation, not those records, and is not a gap.
    this.watermark = Math.max(cursor.throughSequence, this.resetSequence)
    this.hasCursor = true
    this.highestSequence = Math.max(this.watermark, ...this.retained.keys())
    for (const sequence of this.retained.keys())
      if (sequence <= this.watermark) this.retained.delete(sequence)
    for (const [, event] of [...this.retained].sort(([a], [b]) => a - b))
      this.messages = this.project(this.messages, event)
    this.legacySinceSnapshot.length = 0

    const epochChanged = this.epochMoved
    this.epochMoved = false
    return { messages: this.messages, gapDetected: false, epochChanged }
  }

  reset(epoch: string | null = null): MessageBlock[] {
    this.messages = []
    this.epoch = epoch
    this.watermark = 0
    this.highestSequence = 0
    this.resetSequence = 0
    this.epochMoved = false
    this.hasCursor = false
    this.latestRequestId = null
    this.retained.clear()
    this.legacySinceSnapshot.length = 0
    return this.messages
  }

  current(): MessageBlock[] {
    return this.messages
  }
}
