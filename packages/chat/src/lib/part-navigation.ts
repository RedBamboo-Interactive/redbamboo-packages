import type { MessagePart } from "../types"

/** One rendered run of activity squares, identified by its block id. */
export interface SquareRow {
  id: string
  parts: readonly MessagePart[]
  /**
   * Jobs this row draws as twins, in order. `after` is the index in `parts` of
   * the tool call that launched the job: its twin sits right after that square
   * and steps right after it. -1 (no loaded result names the job): at the end
   * of the row's last frieze, after every square.
   */
  jobs?: readonly RowJob[]
}

export interface RowJob {
  id: string
  after: number
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

/**
 * Every square across `rows`, in timeline order, as drawn: a twin right after
 * the square that launched its job, the rest after the row's squares.
 */
export function squareSequence(rows: readonly SquareRow[]): SquareRef[] {
  const sequence: SquareRef[] = []
  for (const row of rows) {
    const jobs = row.jobs ?? []
    const placed = new Set<string>()
    const twinsAfter = (index: number) => jobs.forEach((job, order) => {
      if (job.after !== index) return
      placed.add(job.id)
      sequence.push({ rowId: row.id, index: row.parts.length + order, jobId: job.id })
    })
    row.parts.forEach((part, index) => {
      if (!isInspectablePart(part)) return
      sequence.push({ rowId: row.id, index })
      twinsAfter(index)
    })
    jobs.forEach((job, order) => {
      if (!placed.has(job.id)) sequence.push({ rowId: row.id, index: row.parts.length + order, jobId: job.id })
    })
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
