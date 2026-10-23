import type { MessageBlock, MessagePart, TurnOrigin } from "../types"
import { TURN_ORIGIN_KEY, turnOriginOf } from "./background-work.ts"

/** A turn-origin marker drawn inside an activity frieze, before `parts[before]`. */
export interface ActivityTurnOrigin {
  /** Index into the row's parts; equal to `parts.length` when nothing follows it. */
  before: number
  origin: TurnOrigin
  /** The originating turn's identity (its messageUid when known). */
  turnKey: string
}

export interface ActivityTimelineRow {
  key: string
  kind: "activity" | "message"
  block: MessageBlock
  /** Original message indexes contributing parts to this rendered row. */
  sourceIndices: number[]
  /** Remove the normal inter-message gap when the next row continues a source block. */
  compactAfter: boolean
  /** Message-level actions belong to the final content row of an original block. */
  ownsActions: boolean
  /** Sender identity belongs to the first content row of an original block. */
  ownsSender: boolean
  /** Turns that start inside this activity row, positioned among its parts. */
  turnOrigins?: ActivityTurnOrigin[]
}

function isVisibleContent(part: MessagePart): boolean {
  if (part.type === "audio" || part.type === "image") return true
  if (part.type !== "text") return false
  return !!(
    part.content.trim()
    || part.images?.length
    || part.attachments?.length
  )
}

function uniqueIndexes(indexes: number[]): number[] {
  return [...new Set(indexes)]
}

function withoutTurnOrigin(block: MessageBlock): MessageBlock {
  if (!block.metadata || !(TURN_ORIGIN_KEY in block.metadata)) return block
  const { [TURN_ORIGIN_KEY]: _origin, ...metadata } = block.metadata
  return { ...block, metadata }
}

/**
 * Project canonical conversation blocks into visual timeline rows.
 *
 * Events, thinking, tool calls, results and errors share one activity frieze.
 * Persisted message boundaries are deliberately irrelevant to that frieze:
 * only visible conversational content flushes it. The canonical blocks remain
 * untouched for stream targeting, persistence, metadata and reactions.
 *
 * A turn origin (what woke a self-started turn) is turn-level, not segment-level:
 * it joins the frieze once, at the turn's chronological start, and is stripped
 * from the content rows the turn is split into.
 */
export function projectActivityTimeline(blocks: MessageBlock[], indexOffset = 0): ActivityTimelineRow[] {
  const rows: ActivityTimelineRow[] = []
  let activityParts: MessagePart[] = []
  let activitySources: number[] = []
  let activityFirstBlock: MessageBlock | null = null
  let activityLastBlock: MessageBlock | null = null
  let activityAnchor: string | null = null
  let activityOrigins: ActivityTurnOrigin[] = []
  const placedOrigins = new Set<string>()

  const flushActivity = () => {
    if ((!activityParts.length && !activityOrigins.length) || !activityFirstBlock || !activityLastBlock || !activityAnchor) return
    const sourceIndices = uniqueIndexes(activitySources)
    rows.push({
      // Anchor the React identity to the first canonical part in this activity
      // run. Appending activity or inserting an unrelated earlier row must not
      // remount the frieze and replay its entrance animation.
      key: `activity:${activityAnchor}`,
      kind: "activity",
      block: {
        id: `activity:${activityAnchor}`,
        role: "assistant",
        parts: activityParts,
        timestamp: activityFirstBlock.timestamp,
        senderAgentId: activityLastBlock.senderAgentId,
      },
      sourceIndices,
      compactAfter: false,
      ownsActions: false,
      ownsSender: false,
      ...(activityOrigins.length ? { turnOrigins: activityOrigins } : {}),
    })
    activityParts = []
    activityOrigins = []
    activitySources = []
    activityFirstBlock = null
    activityLastBlock = null
    activityAnchor = null
  }

  for (let localIndex = 0; localIndex < blocks.length; localIndex++) {
    const block = blocks[localIndex]
    const sourceIndex = indexOffset + localIndex

    // User messages are always conversational boundaries, including context
    // cards and attachment-only messages whose text happens to be empty.
    if (block.role === "user") {
      flushActivity()
      rows.push({
        key: `message:${block.id}`,
        kind: "message",
        block,
        sourceIndices: [sourceIndex],
        compactAfter: false,
        ownsActions: true,
        ownsSender: true,
      })
      continue
    }

    // Continuation segments of one turn share its messageUid; mark it once.
    const origin = turnOriginOf(block)
    const turnKey = typeof block.metadata?.messageUid === "string" ? block.metadata.messageUid : block.id
    if (origin && !placedOrigins.has(turnKey)) {
      placedOrigins.add(turnKey)
      activityFirstBlock ??= block
      // Same anchor the block's own leading activity part would take, so an
      // origin learned late (closing status) does not remount the row.
      activityAnchor ??= `${block.id}:0`
      activityLastBlock = block
      activityOrigins.push({ before: activityParts.length, origin, turnKey })
      activitySources.push(sourceIndex)
    }
    const contentBlock = withoutTurnOrigin(block)

    let contentParts: MessagePart[] = []
    let contentSegment = 0

    const flushContent = () => {
      if (!contentParts.length) return
      rows.push({
        key: `message:${block.id}:${contentSegment++}`,
        kind: "message",
        block: { ...contentBlock, parts: contentParts },
        sourceIndices: [sourceIndex],
        compactAfter: false,
        ownsActions: false,
        ownsSender: false,
      })
      contentParts = []
    }

    for (let partIndex = 0; partIndex < block.parts.length; partIndex++) {
      const part = block.parts[partIndex]
      if (isVisibleContent(part)) {
        flushActivity()
        contentParts.push(part)
        continue
      }

      // Empty text is not an activity and renders no content. Ignoring it here
      // prevents a terminal empty turn from manufacturing a visual boundary.
      if (part.type === "text") continue

      flushContent()
      activityFirstBlock ??= block
      activityAnchor ??= `${block.id}:${partIndex}`
      activityLastBlock = block
      activityParts.push(part)
      activitySources.push(sourceIndex)
    }
    flushContent()
  }
  flushActivity()

  // A split block should retain the spacing it had before projection: adjacent
  // rows sharing a source block are two segments of one message, not two posts.
  for (let i = 0; i < rows.length - 1; i++) {
    const next = new Set(rows[i + 1].sourceIndices)
    rows[i].compactAfter = rows[i].sourceIndices.some(index => next.has(index))
  }

  // Keep message metadata/reactions on one stable content row per source block.
  const firstContent = new Map<number, number>()
  const lastContent = new Map<number, number>()
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    if (rows[rowIndex].kind !== "message") continue
    for (const sourceIndex of rows[rowIndex].sourceIndices) {
      if (!firstContent.has(sourceIndex)) firstContent.set(sourceIndex, rowIndex)
      lastContent.set(sourceIndex, rowIndex)
    }
  }
  for (const [sourceIndex, rowIndex] of firstContent) {
    if (rows[rowIndex].sourceIndices.length === 1) rows[rowIndex].ownsSender = true
    const lastRow = lastContent.get(sourceIndex)
    if (lastRow !== undefined && rows[lastRow].sourceIndices.length === 1) rows[lastRow].ownsActions = true
  }

  return rows
}
