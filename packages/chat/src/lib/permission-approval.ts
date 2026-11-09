import type {
  ChatEvent,
  MessageBlock,
  MessagePart,
  PendingQuestion,
  PermissionApproval,
  PermissionApprovals,
  PermissionDecision,
  PermissionOutcome,
  PermissionRequest,
  QuestionState,
} from "../types"

export const PERMISSION_DECISIONS: readonly PermissionDecision[] = ["allow_once", "allow_session", "deny"]

/** Kind defaults to "question": an entry without it behaves exactly as before kinds existed. */
export function isPermissionQuestion(question: PendingQuestion | null | undefined): question is PendingQuestion & { kind: "permission" } {
  return question?.kind === "permission"
}

/** The pending question an AskUserQuestion card and the composer may answer; never an approval. */
export function answerableQuestion(question: PendingQuestion | null | undefined): PendingQuestion | null {
  return question && !isPermissionQuestion(question) ? question : null
}

function parseInput(raw: string | null | undefined): unknown {
  if (!raw) return undefined
  try { return JSON.parse(raw) } catch { return raw }
}

function readOptions(raw: unknown): PermissionDecision[] {
  if (!Array.isArray(raw)) return [...PERMISSION_DECISIONS]
  const offered = PERMISSION_DECISIONS.filter(decision => raw.includes(decision))
  return offered.length ? offered : [...PERMISSION_DECISIONS]
}

/** Read the request off a `question` event of kind permission, tolerating a sparse payload. */
export function readPermissionRequest(event: ChatEvent): PermissionRequest {
  const given = event.permission ?? null
  const toolName = given?.toolName || event.toolName || "Tool"
  const input = given && "input" in given ? given.input : parseInput(event.toolInput)
  return {
    toolName,
    toolUseId: given?.toolUseId ?? event.toolUseId ?? event.messageId ?? null,
    summary: given?.summary || summarizeToolInput(toolName, input),
    input,
    cwd: given?.cwd ?? null,
    options: readOptions(given?.options),
  }
}

/** One line saying what the tool is about to do, when the server sent no summary. */
export function summarizeToolInput(toolName: string, input: unknown): string | null {
  if (typeof input === "string") return input.trim() ? input : null
  if (!input || typeof input !== "object") return null
  const record = input as Record<string, unknown>
  for (const field of ["command", "cmd", "file_path", "notebook_path", "path", "url", "pattern", "query"]) {
    const value = record[field]
    if (typeof value === "string" && value.trim()) return value
    if (Array.isArray(value) && value.every(item => typeof item === "string")) return value.join(" ")
  }
  return toolName
}

export function approvalKey(request: PermissionRequest, requestId: string | null | undefined): string {
  return request.toolUseId || requestId || request.toolName
}

function pendingFor(approval: PermissionApproval): PendingQuestion {
  const what = approval.request.summary ? `: ${approval.request.summary}` : ""
  return {
    question: `Allow ${approval.request.toolName}${what}?`,
    requestId: approval.requestId,
    kind: "permission",
    permission: approval.request,
  }
}

/** Build a pending question for a permission request, e.g. from a snapshot's `pendingQuestions`. */
export function permissionPendingQuestion(request: PermissionRequest, requestId: string | null): PendingQuestion {
  return pendingFor({ key: approvalKey(request, requestId), requestId, request, outcome: null })
}

const DECISION_WORDS: Record<string, PermissionDecision> = {
  allow_once: "allow_once", allowed_once: "allow_once", allow: "allow_once", allowed: "allow_once",
  approved: "allow_once", accept: "allow_once", accepted: "allow_once",
  allow_session: "allow_session", allowed_session: "allow_session", allow_always: "allow_session",
  acceptforsession: "allow_session",
  deny: "deny", denied: "deny", decline: "deny", declined: "deny", reject: "deny", rejected: "deny",
}
const PASSTHROUGH = new Set<PermissionOutcome>(["timeout", "cancelled", "session_ended", "answered"])

/** Read a resolution event's outcome. The explicit `decision` field wins over `content`. */
export function permissionOutcome(event: Pick<ChatEvent, "content" | "decision">): PermissionOutcome {
  if (event.decision && PERMISSION_DECISIONS.includes(event.decision)) return event.decision
  const word = (event.content ?? "").trim()
  const decision = DECISION_WORDS[word.toLowerCase()]
  if (decision) return decision
  return PASSTHROUGH.has(word as PermissionOutcome) ? word as PermissionOutcome : "answered"
}

function lastOpen(permissions: PermissionApprovals): PermissionApproval | undefined {
  return Object.values(permissions).filter(approval => approval.outcome === null).at(-1)
}

/** A pending permission a host put in state directly (a snapshot) joins the record. */
export function withPendingRecorded(state: QuestionState): QuestionState {
  const pending = state.pending
  if (!isPermissionQuestion(pending) || !pending.permission) return state
  const key = approvalKey(pending.permission, pending.requestId)
  const known = state.permissions?.[key]
  // Known by this requestId, open or settled: a stale snapshot must not reopen it.
  if (known && known.requestId === (pending.requestId ?? null)) return state
  return {
    ...state,
    permissions: {
      ...state.permissions,
      [key]: { key, requestId: pending.requestId ?? null, request: pending.permission, outcome: null },
    },
  }
}

/**
 * A permission request opened. It parks the turn, unless an AskUserQuestion is
 * already pending: that one keeps the composer, and the approval card still
 * waits with its own buttons.
 */
export function openPermission(prev: QuestionState, event: ChatEvent): QuestionState {
  const request = readPermissionRequest(event)
  const requestId = event.requestId ?? null
  const key = approvalKey(request, requestId)
  const known = prev.permissions?.[key]
  // The same request again (a reconnect re-delivering it) after it resolved is stale.
  if (known && known.outcome !== null && requestId && known.requestId === requestId) return prev
  const approval: PermissionApproval = { key, requestId, request, outcome: null }
  const permissions = { ...prev.permissions, [key]: approval }
  const keepQuestion = prev.pending && !isPermissionQuestion(prev.pending)
  return { pending: keepQuestion ? prev.pending : pendingFor(approval), outcome: prev.outcome, permissions }
}

/** Settle one approval; the turn stays parked while another one still waits. */
export function closePermission(prev: QuestionState, key: string, outcome: PermissionOutcome): QuestionState {
  const approval = prev.permissions?.[key]
  if (!approval) return prev
  // "answered" says less than the decision already known, so it doesn't replace it.
  const settled = outcome === "answered" && approval.outcome && PERMISSION_DECISIONS.includes(approval.outcome as PermissionDecision)
    ? approval.outcome
    : outcome
  const permissions = { ...prev.permissions, [key]: { ...approval, outcome: settled } }
  const pendingClosed = isPermissionQuestion(prev.pending)
    && !!prev.pending.permission
    && approvalKey(prev.pending.permission, prev.pending.requestId) === key
  const next = lastOpen(permissions)
  return {
    pending: pendingClosed ? next ? pendingFor(next) : null : prev.pending,
    outcome: prev.outcome,
    permissions,
  }
}

/** The approval a resolution event closes: by requestId, else the pending one when it is an approval. */
export function resolvedApproval(prev: QuestionState, event: ChatEvent): PermissionApproval | undefined {
  const approvals = Object.values(prev.permissions ?? {})
  // Settled ones too: a client that settled it on its own POST still takes the server's word.
  if (event.requestId) return approvals.find(approval => approval.requestId === event.requestId)
  if (!isPermissionQuestion(prev.pending) || !prev.pending.permission) return undefined
  return prev.permissions?.[approvalKey(prev.pending.permission, prev.pending.requestId)]
}

/** The approval waiting on this tool call's result, if any. */
export function approvalForToolResult(prev: QuestionState, event: ChatEvent): PermissionApproval | undefined {
  const toolUseId = event.toolUseId ?? event.messageId
  if (!toolUseId) return undefined
  const approval = prev.permissions?.[toolUseId]
  return approval?.outcome === null ? approval : undefined
}

/**
 * Nothing is pending but an approval still waits (the question parked above it
 * just resolved): the turn stays parked, on that approval.
 */
export function reparkOnOpenApproval(state: QuestionState): QuestionState {
  if (state.pending || !state.permissions) return state
  const open = lastOpen(state.permissions)
  return open ? { ...state, pending: pendingFor(open) } : state
}

/** The turn ended: nothing can still be waiting for a decision. */
export function abandonPermissions(state: QuestionState): QuestionState {
  if (!state.permissions || !lastOpen(state.permissions)) return state
  const permissions: PermissionApprovals = {}
  for (const [key, approval] of Object.entries(state.permissions))
    permissions[key] = approval.outcome === null ? { ...approval, outcome: "unresolved" } : approval
  return {
    ...state,
    pending: isPermissionQuestion(state.pending) ? null : state.pending,
    permissions,
  }
}

/**
 * Every approval to draw: the recorded ones, plus a pending one the host
 * passed without a record (it only tracks `pendingQuestion`).
 */
export function visibleApprovals(
  permissions: PermissionApprovals | null | undefined,
  pending: PendingQuestion | null | undefined,
): PermissionApproval[] {
  const approvals = Object.values(permissions ?? {})
  if (isPermissionQuestion(pending) && pending.permission) {
    const key = approvalKey(pending.permission, pending.requestId)
    const recorded = approvals.findIndex(approval => approval.key === key)
    const live: PermissionApproval = { key, requestId: pending.requestId ?? null, request: pending.permission, outcome: null }
    if (recorded === -1) approvals.push(live)
    // The host's pending entry is authoritative while it is live.
    else if (approvals[recorded].outcome !== null && approvals[recorded].requestId !== live.requestId) approvals[recorded] = live
  }
  return approvals
}

/** Approvals whose tool call this conversation doesn't show: they fall back to a standalone card. */
export function unanchoredApprovals(messages: readonly MessageBlock[], approvals: readonly PermissionApproval[]): PermissionApproval[] {
  if (!approvals.length) return []
  const toolUseIds = new Set<string>()
  for (const block of messages)
    for (const part of block.parts)
      if (part.type === "tool_use") {
        const id = toolUseIdOf(part)
        if (id) toolUseIds.add(id)
      }
  return approvals.filter(approval => !approval.request.toolUseId || !toolUseIds.has(approval.request.toolUseId))
}

export function toolUseIdOf(part: MessagePart): string | undefined {
  return part.toolUseId ?? part.messageId
}

/** The approvals drawn on this block's tool calls, by tool call id. */
export function approvalsOnParts(parts: readonly MessagePart[], approvals: readonly PermissionApproval[] | undefined): Map<string, PermissionApproval> {
  const found = new Map<string, PermissionApproval>()
  if (!approvals?.length) return found
  const byToolUseId = new Map(approvals.filter(approval => approval.request.toolUseId).map(approval => [approval.request.toolUseId!, approval]))
  for (const part of parts) {
    if (part.type !== "tool_use") continue
    const id = toolUseIdOf(part)
    const approval = id ? byToolUseId.get(id) : undefined
    if (id && approval) found.set(id, approval)
  }
  return found
}
