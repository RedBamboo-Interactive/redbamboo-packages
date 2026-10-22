import type { BackgroundTaskState, ChatEvent, MessageBlock, MessagePart, TurnOrigin } from "../types"

/**
 * Background work: subagents and background shells that keep running after the
 * tool call that launched them returned, often after the turn itself ended.
 *
 * RedCompute tags every record of such work with `parentToolUseId` (the
 * launching tool call) and reports each task's lifecycle as `task` records. A
 * background record is never a turn: it is routed out of block building and
 * attached to the part whose `toolUseId` matches, wherever that block is. One
 * implementation serves the live path (`applyEvent`) and history
 * (`rebuildBlocks`), so both produce the same tree.
 *
 * A record whose parent is not loaded yet (an older transcript page, or a
 * child observed before its launcher) waits in `metadata.backgroundOrphans` on
 * the last block and is attached as soon as the parent appears. It is never
 * rendered on its own.
 */

/** Event types this client understands. Anything else is skipped, not rendered. */
export const KNOWN_EVENT_TYPES: ReadonlySet<string> = new Set([
  "text", "thinking", "tool_use", "tool_result", "error", "status",
  "question", "question_resolved", "image", "task",
])

/** Durable record types this client understands. */
export const KNOWN_RECORD_TYPES: ReadonlySet<string> = new Set([
  "text", "thinking", "tool_use", "tool_result", "error", "status", "image", "audio", "task",
])

export const BACKGROUND_ORPHANS_KEY = "backgroundOrphans"
export const TURN_ORIGIN_KEY = "turnOrigin"

interface BackgroundSource {
  type?: string
  eventType?: string
  parentToolUseId?: string | null
}

/**
 * True when an event belongs to background work. Product hooks use it to keep
 * such events from latching `isStreaming`, the Stop button, steering or the
 * session's Active state: the main loop may well be idle.
 */
export function isBackgroundEvent(event: Pick<ChatEvent, "type" | "parentToolUseId">): boolean {
  return event.type === "task" || !!event.parentToolUseId
}

export function isBackgroundRecord(record: BackgroundSource): boolean {
  return (record.eventType ?? record.type) === "task" || !!record.parentToolUseId
}

/** Tool-call identity of a tool event or record; RedCompute carries it as `messageId`. */
export function toolUseIdOf(source: {
  type?: string
  eventType?: string
  toolUseId?: string | null
  messageId?: string | null
}): string | undefined {
  if (source.toolUseId) return source.toolUseId
  const type = source.eventType ?? source.type
  return (type === "tool_use" || type === "tool_result") && source.messageId ? source.messageId : undefined
}

export function parseTaskState(toolInput: string | null | undefined): BackgroundTaskState | null {
  if (!toolInput) return null
  try {
    const parsed = JSON.parse(toolInput) as Partial<BackgroundTaskState>
    if (!parsed || typeof parsed.taskId !== "string" || typeof parsed.status !== "string") return null
    return {
      taskId: parsed.taskId,
      kind: typeof parsed.kind === "string" ? parsed.kind : "other",
      status: parsed.status,
      description: parsed.description ?? null,
      agentType: parsed.agentType ?? null,
      summary: parsed.summary ?? null,
      usage: parsed.usage ?? null,
      startedAt: parsed.startedAt ?? null,
      endedAt: parsed.endedAt ?? null,
      parentTaskId: parsed.parentTaskId ?? null,
    }
  } catch {
    return null
  }
}

export function isTerminalTaskStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "failed" || status === "stopped" || status === "lost"
}

/** A terminal state is never regressed by a late or replayed start record. */
export function foldTaskState(previous: BackgroundTaskState | undefined, next: BackgroundTaskState): BackgroundTaskState {
  if (!previous) return next
  if (isTerminalTaskStatus(previous.status) && !isTerminalTaskStatus(next.status)) return previous
  return {
    ...previous,
    ...Object.fromEntries(Object.entries(next).filter(([, value]) => value != null)),
  } as BackgroundTaskState
}

/** The part a background event or record contributes under its parent. */
export function backgroundPart(source: {
  type?: string
  eventType?: string
  content?: string | null
  toolName?: string | null
  toolInput?: string | null
  toolResult?: string | null
  payloadRef?: MessagePart["payloadRef"] | null
  phase?: MessagePart["phase"] | null
  messageId?: string | null
  toolUseId?: string | null
  parentToolUseId?: string | null
}): MessagePart {
  const type = (source.eventType ?? source.type) as MessagePart["type"]
  const toolUseId = toolUseIdOf(source)
  const part: MessagePart = {
    type,
    content: source.content || source.toolResult || "",
    ...(source.toolName ? { toolName: source.toolName } : {}),
    ...(source.toolInput ? { toolInput: source.toolInput } : {}),
    ...(source.payloadRef ? { payloadRef: source.payloadRef } : {}),
    ...(source.phase ? { phase: source.phase } : {}),
    ...(source.messageId ? { messageId: source.messageId } : {}),
    ...(toolUseId ? { toolUseId } : {}),
    ...(source.parentToolUseId ? { parentToolUseId: source.parentToolUseId } : {}),
  }
  if (type === "thinking") part.thinkingState = "completed"
  if (type === "task") {
    const task = parseTaskState(source.toolInput)
    if (task) part.task = task
  }
  return part
}

/** Identity of a background part for de-duplication across live and history delivery. */
function partKey(part: MessagePart): string | null {
  if (part.type === "task") return part.task ? `task:${part.task.taskId}:${part.task.status}` : null
  if (part.toolUseId && (part.type === "tool_use" || part.type === "tool_result")) return `${part.type}:${part.toolUseId}`
  if (part.messageId && (part.type === "text" || part.type === "thinking")) return `${part.type}:${part.messageId}`
  return null
}

/**
 * Attach background parts to their launching tool calls. Returns the same
 * array when nothing changed. Unresolved parts are parked on the last block.
 */
export function attachBackground(messages: MessageBlock[], parts: readonly MessagePart[]): MessageBlock[] {
  const orphans = collectOrphans(messages)
  if (parts.length === 0 && orphans.length === 0) return messages
  const pending = [...orphans, ...parts]
  const next = orphans.length > 0 ? clearOrphans(messages) : [...messages]
  const unresolved: MessagePart[] = []
  // Parents can arrive in the same batch (nested agents), so retry until no progress.
  let queue = pending
  let progressed = true
  while (queue.length > 0 && progressed) {
    progressed = false
    const remaining: MessagePart[] = []
    for (const part of queue) {
      if (part.parentToolUseId && attachOne(next, part)) progressed = true
      else remaining.push(part)
    }
    queue = remaining
  }
  unresolved.push(...queue)
  if (unresolved.length > 0) {
    if (next.length === 0) return next
    const last = next.length - 1
    next[last] = {
      ...next[last],
      metadata: { ...next[last].metadata, [BACKGROUND_ORPHANS_KEY]: unresolved },
    }
  }
  return next
}

/**
 * Attach background records to blocks a host assembled itself (for example by
 * rebuilding record spans around its own overlay blocks). Hosts route these
 * records out of their spans and call this once on the final array.
 */
export function attachBackgroundRecords<T extends BackgroundSource & Parameters<typeof backgroundPart>[0]>(
  messages: MessageBlock[],
  records: readonly T[],
): MessageBlock[] {
  return attachBackground(messages, records.filter(isBackgroundRecord).map(backgroundPart))
}

/** Re-attach parked parts after their parents may have been loaded. */
export function resolveBackgroundOrphans(messages: MessageBlock[]): MessageBlock[] {
  return collectOrphans(messages).length === 0 ? messages : attachBackground(messages, [])
}

export function collectOrphans(messages: readonly MessageBlock[]): MessagePart[] {
  const orphans: MessagePart[] = []
  for (const block of messages) {
    const parked = block.metadata?.[BACKGROUND_ORPHANS_KEY]
    if (Array.isArray(parked)) orphans.push(...parked as MessagePart[])
  }
  return orphans
}

function clearOrphans(messages: MessageBlock[]): MessageBlock[] {
  return messages.map(block => {
    if (!block.metadata || !(BACKGROUND_ORPHANS_KEY in block.metadata)) return block
    const { [BACKGROUND_ORPHANS_KEY]: _parked, ...metadata } = block.metadata
    return { ...block, metadata: Object.keys(metadata).length > 0 ? metadata : undefined }
  })
}

/** Mutates `messages` (a private copy) in place with copied blocks and parts on the path. */
function attachOne(messages: MessageBlock[], part: MessagePart): boolean {
  for (let blockIndex = messages.length - 1; blockIndex >= 0; blockIndex--) {
    const block = messages[blockIndex]
    const replaced = replaceInParts(block.parts, part)
    if (replaced) {
      messages[blockIndex] = { ...block, parts: replaced }
      return true
    }
  }
  return false
}

function replaceInParts(parts: MessagePart[], child: MessagePart): MessagePart[] | null {
  for (let index = parts.length - 1; index >= 0; index--) {
    const candidate = parts[index]
    if (candidate.type === "tool_use" && candidate.toolUseId === child.parentToolUseId) {
      const updated = [...parts]
      updated[index] = withChild(candidate, child)
      return updated
    }
    if (candidate.children?.length) {
      const nested = replaceInParts(candidate.children, child)
      if (nested) {
        const updated = [...parts]
        updated[index] = { ...candidate, children: nested }
        return updated
      }
    }
  }
  return null
}

function withChild(parent: MessagePart, child: MessagePart): MessagePart {
  if (child.type === "task") {
    return child.task ? { ...parent, task: foldTaskState(parent.task, child.task) } : parent
  }
  const children = parent.children ?? []
  const key = partKey(child)
  if (key) {
    const existing = children.findIndex(candidate => partKey(candidate) === key)
    if (existing !== -1) {
      const updated = [...children]
      // Keep nested state accumulated on the existing child (its own children, task).
      updated[existing] = { ...child, children: children[existing].children, task: children[existing].task }
      return { ...parent, children: updated }
    }
  }
  return { ...parent, children: [...children, child] }
}

/** Find a part (top-level or nested) by its tool-call identity. */
export function findPartByToolUseId(messages: readonly MessageBlock[], toolUseId: string): { part: MessagePart; blockIndex: number } | null {
  const search = (parts: readonly MessagePart[]): MessagePart | null => {
    for (const part of parts) {
      if (part.type === "tool_use" && part.toolUseId === toolUseId) return part
      if (part.children?.length) {
        const found = search(part.children)
        if (found) return found
      }
    }
    return null
  }
  for (let blockIndex = messages.length - 1; blockIndex >= 0; blockIndex--) {
    const part = search(messages[blockIndex].parts)
    if (part) return { part, blockIndex }
  }
  return null
}

/**
 * The top-level square whose subtree holds a tool call: what a client opens to
 * show a (possibly nested) background task. Null when it is not loaded.
 */
export function findLaunchingSquare(messages: readonly MessageBlock[], toolUseId: string): { blockIndex: number; toolUseId: string } | null {
  const contains = (part: MessagePart): boolean =>
    (part.type === "tool_use" && part.toolUseId === toolUseId) || !!part.children?.some(contains)
  for (let blockIndex = messages.length - 1; blockIndex >= 0; blockIndex--) {
    const square = messages[blockIndex].parts.find(contains)
    if (square?.toolUseId) return { blockIndex, toolUseId: square.toolUseId }
  }
  return null
}

/**
 * The result answering a tool call. Pairs by tool-call identity when both sides
 * carry it (children interleave, so position is no longer reliable) and falls
 * back to the legacy "next result before the next call" rule.
 */
export function findPairedResult(allParts: readonly MessagePart[], toolUsePart: MessagePart): MessagePart | undefined {
  if (toolUsePart.toolUseId) {
    const byId = allParts.find(part => part.type === "tool_result" && part.toolUseId === toolUsePart.toolUseId)
    if (byId) return byId
  }
  const idx = allParts.indexOf(toolUsePart)
  if (idx === -1) return undefined
  for (let j = idx + 1; j < allParts.length; j++) {
    if (allParts[j].type === "tool_result") {
      // A result that names a different call answers that call, not this one.
      if (toolUsePart.toolUseId && allParts[j].toolUseId && allParts[j].toolUseId !== toolUsePart.toolUseId) continue
      return allParts[j]
    }
    if (allParts[j].type === "tool_use") return undefined
  }
  return undefined
}

export function turnOriginOf(block: MessageBlock): TurnOrigin | null {
  const origin = block.metadata?.[TURN_ORIGIN_KEY]
  return origin && typeof origin === "object" && typeof (origin as TurnOrigin).kind === "string"
    ? origin as TurnOrigin : null
}

/** Every task folded into the conversation, keyed by task id, with its launching part. */
export function indexBackgroundTasks(messages: readonly MessageBlock[]): Map<string, { task: BackgroundTaskState; part: MessagePart }> {
  const index = new Map<string, { task: BackgroundTaskState; part: MessagePart }>()
  const visit = (parts: readonly MessagePart[]) => {
    for (const part of parts) {
      if (part.task) index.set(part.task.taskId, { task: part.task, part })
      if (part.children?.length) visit(part.children)
    }
  }
  for (const block of messages) visit(block.parts)
  return index
}

/** "2 agents", "1 shell", "1 agent · 1 shell" style counts for running background work. */
export function describeBackgroundCount(tasks: readonly { kind?: string | null }[]): string {
  const agents = tasks.filter(task => task.kind === "agent").length
  const shells = tasks.filter(task => task.kind === "shell").length
  const other = tasks.length - agents - shells
  const segments: string[] = []
  if (agents) segments.push(`${agents} ${agents === 1 ? "agent" : "agents"}`)
  if (shells) segments.push(`${shells} ${shells === 1 ? "shell" : "shells"}`)
  if (other) segments.push(`${other} ${other === 1 ? "task" : "tasks"}`)
  return segments.join(" · ")
}

/** The Stop affordance's warning: interrupting the main turn also kills every running task. */
export function backgroundStopWarning(tasks: readonly { kind?: string | null }[] | undefined): string | null {
  if (!tasks?.length) return null
  const allAgents = tasks.every(task => task.kind === "agent")
  const noun = allAgents ? (tasks.length === 1 ? "background agent" : "background agents")
    : (tasks.length === 1 ? "background task" : "background tasks")
  return `also stops ${tasks.length} ${noun}`
}
