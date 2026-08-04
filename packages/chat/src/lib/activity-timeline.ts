import type { MessageBlock, MessagePart } from "../types"

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

/**
 * Project canonical conversation blocks into visual timeline rows.
 *
 * Events, thinking, tool calls, results and errors share one activity frieze.
 * Persisted message boundaries are deliberately irrelevant to that frieze:
 * only visible conversational content flushes it. The canonical blocks remain
 * untouched for stream targeting, persistence, metadata and reactions.
 */
export function projectActivityTimeline(blocks: MessageBlock[], indexOffset = 0): ActivityTimelineRow[] {
  const rows: ActivityTimelineRow[] = []
  let activityParts: MessagePart[] = []
  let activitySources: number[] = []
  let activityFirstBlock: MessageBlock | null = null
  let activityLastBlock: MessageBlock | null = null
  let rowSequence = 0

  const flushActivity = () => {
    if (!activityParts.length || !activityFirstBlock || !activityLastBlock) return
    const sourceIndices = uniqueIndexes(activitySources)
    rows.push({
      key: `activity:${activityFirstBlock.id}:${activityLastBlock.id}:${rowSequence++}`,
      kind: "activity",
      block: {
        id: `activity:${activityFirstBlock.id}:${activityLastBlock.id}:${rowSequence}`,
        role: "assistant",
        parts: activityParts,
        timestamp: activityFirstBlock.timestamp,
        senderAgentId: activityLastBlock.senderAgentId,
      },
      sourceIndices,
      compactAfter: false,
      ownsActions: false,
      ownsSender: false,
    })
    activityParts = []
    activitySources = []
    activityFirstBlock = null
    activityLastBlock = null
  }

  for (let localIndex = 0; localIndex < blocks.length; localIndex++) {
    const block = blocks[localIndex]
    const sourceIndex = indexOffset + localIndex

    // User messages are always conversational boundaries, including context
    // cards and attachment-only messages whose text happens to be empty.
    if (block.role === "user") {
      flushActivity()
      rows.push({
        key: `message:${block.id}:${rowSequence++}`,
        kind: "message",
        block,
        sourceIndices: [sourceIndex],
        compactAfter: false,
        ownsActions: true,
        ownsSender: true,
      })
      continue
    }

    let contentParts: MessagePart[] = []
    let contentSegment = 0

    const flushContent = () => {
      if (!contentParts.length) return
      rows.push({
        key: `message:${block.id}:${contentSegment++}:${rowSequence++}`,
        kind: "message",
        block: { ...block, parts: contentParts },
        sourceIndices: [sourceIndex],
        compactAfter: false,
        ownsActions: false,
        ownsSender: false,
      })
      contentParts = []
    }

    for (const part of block.parts) {
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
