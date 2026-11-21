import type { MessagePart } from "../types"

/** One rendered run of activity squares, identified by its block id. */
export interface SquareRow {
  id: string
  parts: readonly MessagePart[]
  /**
   * Jobs this row draws as twins, in order. They sit at the end of the row's
   * last frieze, after every square, so they step after the row's squares.
   */
  jobIds?: readonly string[]
}

/**
 * A square's position: the row it renders in and its index in that row's parts.
 * A job's twin carries its `jobId`; its `index` then counts past the parts.
 */
export interface SquareRef {
  rowId: string
  index: number
  jobId?: string
}

/**
 * An error the turn ended on, with the provider's words, renders as its own
 * visible row rather than a square: a usage limit drawn as a 10 px red square
 * left a dead thread looking quiet (2026-11-15, "You've hit your Fable limit").
 */
export function isVisibleErrorPart(part: MessagePart): boolean {
  return part.type === "error" && !!part.content?.trim()
}

/**
 * Parts that render as activity squares. Text, audio, images and visible errors
 * render inline; a tool_result is reached through its tool_use square rather than its own.
 */
export function isInspectablePart(part: MessagePart): boolean {
  return part.type !== "text" && part.type !== "audio" && part.type !== "image" && part.type !== "tool_result"
    && !isVisibleErrorPart(part)
}

/** Every square across `rows`, in timeline order, each row's job twins after its squares. */
export function squareSequence(rows: readonly SquareRow[]): SquareRef[] {
  const sequence: SquareRef[] = []
  for (const row of rows) {
    row.parts.forEach((part, index) => { if (isInspectablePart(part)) sequence.push({ rowId: row.id, index }) })
    row.jobIds?.forEach((jobId, index) => sequence.push({ rowId: row.id, index: row.parts.length + index, jobId }))
  }
  return sequence
}

/** A twin is found by its job, wherever the row's parts have grown to; a square by its index. */
export function squarePosition(sequence: readonly SquareRef[], square: SquareRef): number {
  return sequence.findIndex(s => s.rowId === square.rowId
    && (square.jobId !== undefined ? s.jobId === square.jobId : s.jobId === undefined && s.index === square.index))
}

/**
 * The square one before or after `from`, or undefined at either end.
 * Navigation deliberately stops instead of wrapping.
 */
export function stepSquare(rows: readonly SquareRow[], from: SquareRef, direction: -1 | 1): SquareRef | undefined {
  const sequence = squareSequence(rows)
  const position = squarePosition(sequence, from)
  if (position === -1) return undefined
  return sequence[position + direction]
}
