// The canonical transcript-page contract (RedCompute `GET /ai-session/sessions/{id}/transcript-page`,
// carried unchanged inside Nova's history-page). No runtime imports, so node tests load it directly.
import type { PersistedTranscriptPage } from "./durable-transcript-pager.ts"
import type { PersistedMessage } from "./rebuild-blocks.ts"

export type TranscriptPageDirection = "newest" | "before" | "after"

export interface TranscriptPageMetadata {
  epoch: string | null
  direction: TranscriptPageDirection
  oldestCursor: string | null
  newestCursor: string | null
  hasEarlier: boolean
  hasLater: boolean
  fromSequence: number | null
  throughSequence: number | null
  boundaryComplete: boolean
}

export interface TranscriptPageResponse<TSession = unknown> {
  session?: TSession
  messages: PersistedMessage[]
  page: TranscriptPageMetadata
}

/** The page envelope's shape; the pager then validates its records, ranges and cursors. */
export function isTranscriptPageMetadata(value: unknown): value is TranscriptPageMetadata {
  if (!value || typeof value !== "object") return false
  const page = value as Partial<TranscriptPageMetadata>
  return (page.direction === "newest" || page.direction === "before" || page.direction === "after")
    && (page.epoch === null || typeof page.epoch === "string")
    && (page.oldestCursor === null || typeof page.oldestCursor === "string")
    && (page.newestCursor === null || typeof page.newestCursor === "string")
    && typeof page.hasEarlier === "boolean"
    && typeof page.hasLater === "boolean"
    && typeof page.boundaryComplete === "boolean"
}

export function isTranscriptPageResponse(value: unknown): value is TranscriptPageResponse {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<TranscriptPageResponse>
  return Array.isArray(candidate.messages) && isTranscriptPageMetadata(candidate.page)
}

export function toPersistedTranscriptPage(messages: PersistedMessage[], page: TranscriptPageMetadata): PersistedTranscriptPage {
  return {
    epoch: page.epoch,
    records: messages,
    oldestCursor: page.oldestCursor,
    newestCursor: page.newestCursor,
    hasEarlier: page.hasEarlier,
    hasLater: page.hasLater,
    fromSequence: page.fromSequence,
    throughSequence: page.throughSequence,
    boundaryComplete: page.boundaryComplete,
  }
}
