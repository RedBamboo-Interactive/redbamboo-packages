import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { processStreamEvent } from "./process-stream-event.ts"
import { rebuildBlocks, type PersistedMessage } from "./rebuild-blocks.ts"
import {
  BACKGROUND_ORPHANS_KEY,
  attachBackground,
  attachBackgroundRecords,
  backgroundPart,
  isBackgroundRecord,
  backgroundStopWarning,
  collectOrphans,
  describeBackgroundCount,
  findPairedResult,
  findLaunchingSquare,
  indexBackgroundTasks,
  isBackgroundEvent,
  resolveBackgroundOrphans,
  turnOriginOf,
} from "./background-work.ts"
import { PART_COLOR, getPartColor, getSpinnerColor, isBackgroundRunning } from "./part-colors.ts"
import { getToolActivityCategory } from "./tool-semantics.ts"
import type { ChatEvent, MessageBlock, MessagePart, QuestionState } from "../types.ts"

// Claude Code subagents keep calling tools after the turn that launched them
// ended. RedCompute now tags every such record with the launching tool call
// (`parentToolUseId`); before, each call landed in the transcript as if the
// main loop made it, and calls after the turn's result rendered as phantom
// assistant turns (Chat Stability Journal cfb5b994).

const fixture = JSON.parse(readFileSync(new URL("./__fixtures__/cfb5b994-skeleton.json", import.meta.url), "utf8")) as {
  records: PersistedMessage[]
}
const EXPLORE_AGENT = "toolu_017QToStCob6o1Ncgpdott9o"
const GMAIL_AGENT = "toolu_01XjYU8qZn4RqfXFTPztraMa"
const LAUNCH_UID = "5c93e15410dd4f2489ae45209e5ce8b2"
const PHANTOM_UIDS = ["e273082c6ba04a2ca02bfae7e644f595", "5881160577d443478f84bd127c745306"]

const ts = "2026-10-22T09:00:00.000Z"
const NO_QUESTION: QuestionState = { pending: null, outcome: null }

function allParts(blocks: readonly MessageBlock[]): MessagePart[] {
  const out: MessagePart[] = []
  const visit = (parts: readonly MessagePart[]) => { for (const part of parts) { out.push(part); if (part.children) visit(part.children) } }
  for (const block of blocks) visit(block.parts)
  return out
}

function square(blocks: readonly MessageBlock[], toolUseId: string): MessagePart {
  const found = allParts(blocks).find(part => part.type === "tool_use" && part.toolUseId === toolUseId)
  assert.ok(found, `square ${toolUseId}`)
  return found
}

function toEvent(record: PersistedMessage): ChatEvent {
  return {
    type: record.eventType as ChatEvent["type"],
    content: record.content ?? null,
    toolName: record.toolName ?? null,
    toolInput: record.toolInput ?? null,
    toolResult: record.toolResult ?? null,
    messageId: record.messageId ?? null,
    messageUid: record.messageUid ?? null,
    parentToolUseId: record.parentToolUseId ?? null,
    turnOrigin: record.turnOrigin ?? null,
    phase: record.phase ?? null,
    epoch: record.epoch ?? null,
    sequence: record.sequence ?? null,
    timestamp: record.timestamp,
    ...(record.eventType === "thinking" ? { isPartial: false } : {}),
  }
}

/** Replays records the way a host does live: user rows are host-owned, the rest stream. */
function replayLive(records: readonly PersistedMessage[], isStreaming = false) {
  let messages: MessageBlock[] = []
  let question = NO_QUESTION
  const backgroundResults: { isStreaming: boolean; background?: boolean }[] = []
  for (const record of [...records].sort((a, b) => (a.sequence ?? 0) - (b.sequence ?? 0))) {
    if (record.role === "user") {
      messages = [...messages, { id: record.messageUid || `u-${record.id}`, role: "user", parts: [{ type: "text", content: "" }], timestamp: record.timestamp }]
      continue
    }
    const event = toEvent(record)
    const result = processStreamEvent(messages, isStreaming, event, false, question)
    if (isBackgroundEvent(event)) backgroundResults.push(result)
    messages = result.messages
    question = result.question
  }
  return { messages, backgroundResults }
}

/** Structure only: what the frieze renders and what children hang off it. */
function shape(blocks: readonly MessageBlock[]): unknown {
  const part = (p: MessagePart): unknown => ({
    type: p.type, toolUseId: p.toolUseId, task: p.task?.status,
    children: p.children?.map(part),
  })
  return blocks.map(block => ({ id: block.id, role: block.role, parts: block.parts.map(part) }))
}

test("cfb5b994: the recorded sequence renders no phantom turn and every subagent call on its Agent square", () => {
  const blocks = rebuildBlocks(fixture.records)

  // The subagent calls minted these uids once the turn had ended. 58811605 held only
  // subagent work, so it disappears. The CLI's own wake turn at 09:07 (thinking and
  // its final answer) reused e273082c, so that block stays, holding only that turn.
  const [wakeUid, phantomUid] = PHANTOM_UIDS
  assert.ok(!blocks.some(block => block.metadata?.messageUid === phantomUid), "no phantom turn")
  const wake = blocks.filter(block => block.metadata?.messageUid === wakeUid)
  assert.deepEqual(wake.flatMap(block => block.parts.map(part => part.type)), ["thinking", "text"])
  assert.equal(blocks.filter(block => block.role === "assistant").length,
    rebuildBlocks(fixture.records.filter(record => !record.parentToolUseId)).filter(block => block.role === "assistant").length)
  assert.ok(blocks.every(block => block.parts.every(part => !part.parentToolUseId)), "no background part inside a turn")

  const explore = square(blocks, EXPLORE_AGENT)
  const gmail = square(blocks, GMAIL_AGENT)
  assert.equal(explore.children?.length, 196)
  assert.equal(gmail.children?.length, 56)
  assert.ok(explore.children!.every(child => child.parentToolUseId === EXPLORE_AGENT))
  // Both Agent squares sit in the launching turn's block.
  const owner = blocks.find(block => block.parts.includes(explore))
  assert.equal(owner?.id, LAUNCH_UID)
  assert.ok(owner?.parts.includes(gmail))
  assert.equal(collectOrphans(blocks).length, 0)
  // Children pair with their own results by id even though both agents interleave.
  const firstCall = explore.children!.find(child => child.type === "tool_use")!
  assert.equal(findPairedResult(explore.children!, firstCall)?.toolUseId, firstCall.toolUseId)
})

test("cfb5b994: live delivery builds the same tree as history and never touches isStreaming", () => {
  const history = rebuildBlocks(fixture.records)
  const live = replayLive(fixture.records)
  assert.deepEqual(shape(live.messages), shape(history))
  assert.ok(live.backgroundResults.length === 252)
  assert.ok(live.backgroundResults.every(result => result.isStreaming === false && result.background === true))

  const streaming = replayLive(fixture.records.filter(record => (record.sequence ?? 0) < 760), true)
  assert.ok(streaming.backgroundResults.every(result => result.isStreaming === true), "a background event leaves the flag as it found it")
})

test("cfb5b994: with the fixed RedCompute's launching uid on children the tree is identical", () => {
  const fixed = fixture.records.map(record => record.parentToolUseId ? { ...record, messageUid: LAUNCH_UID } : record)
  assert.deepEqual(shape(rebuildBlocks(fixed)), shape(rebuildBlocks(fixture.records)))
  assert.deepEqual(shape(replayLive(fixed).messages), shape(rebuildBlocks(fixture.records)))
})

const agentUse = (id: string, uid = "turn-1"): ChatEvent => ({
  type: "tool_use", toolName: "Agent", toolInput: JSON.stringify({ description: "Research", run_in_background: true }),
  messageId: id, messageUid: uid, timestamp: ts,
})
const childUse = (id: string, parent: string, toolName = "Bash"): ChatEvent => ({
  type: "tool_use", toolName, toolInput: JSON.stringify({ command: "echo" }), messageId: id, messageUid: "turn-1",
  parentToolUseId: parent, timestamp: ts,
})
const childResult = (id: string, parent: string): ChatEvent => ({
  type: "tool_result", toolResult: "ok", messageId: id, messageUid: "turn-1", parentToolUseId: parent, timestamp: ts,
})
const taskEvent = (parent: string, taskId: string, status: string, extra: Record<string, unknown> = {}): ChatEvent => ({
  type: "task", messageId: taskId, messageUid: "turn-1", parentToolUseId: parent, timestamp: ts,
  toolInput: JSON.stringify({ taskId, kind: "agent", status, description: "Research", startedAt: ts, ...extra }),
})
const apply = (messages: MessageBlock[], ...events: ChatEvent[]) =>
  events.reduce((current, event) => processStreamEvent(current, false, event).messages, messages)

test("a child observed before its launcher waits off-screen and attaches when the launcher arrives", () => {
  const user: MessageBlock = { id: "u", role: "user", parts: [{ type: "text", content: "go" }], timestamp: ts }
  const early = apply([user], childUse("toolu_child", "toolu_agent"))
  assert.equal(early.length, 1, "no block is opened for the orphan")
  assert.deepEqual(early[0].parts, user.parts)
  assert.equal(collectOrphans(early).length, 1)

  const attached = apply(early, agentUse("toolu_agent"))
  assert.equal(collectOrphans(attached).length, 0)
  assert.equal(square(attached, "toolu_agent").children?.[0]?.toolUseId, "toolu_child")
  assert.equal(attached.filter(block => block.role === "assistant").length, 1)
})

test("a parent on an older page: children park, then attach when that page loads", () => {
  const older: PersistedMessage[] = [
    { id: 1, role: "user", eventType: "text", content: "go", messageUid: "u1", timestamp: ts, epoch: "e", sequence: 1 },
    { id: 2, role: "assistant", eventType: "tool_use", toolName: "Agent", messageId: "toolu_agent", messageUid: "turn-1", timestamp: ts, epoch: "e", sequence: 2 },
    { id: 3, role: "assistant", eventType: "tool_result", messageId: "toolu_agent", messageUid: "turn-1", toolResult: "launched", timestamp: ts, epoch: "e", sequence: 3 },
  ]
  const newer: PersistedMessage[] = [
    { id: 4, role: "user", eventType: "text", content: "next", messageUid: "u2", timestamp: ts, epoch: "e", sequence: 4 },
    { id: 5, role: "assistant", eventType: "tool_use", toolName: "Read", messageId: "toolu_child", messageUid: "turn-1", parentToolUseId: "toolu_agent", timestamp: ts, epoch: "e", sequence: 5 },
    { id: 6, role: "assistant", eventType: "text", content: "answer", messageUid: "turn-2", timestamp: ts, epoch: "e", sequence: 6 },
    { id: 7, role: "system", eventType: "task", messageId: "task-1", messageUid: "turn-1", parentToolUseId: "toolu_agent", timestamp: ts, epoch: "e", sequence: 7,
      toolInput: JSON.stringify({ taskId: "task-1", kind: "agent", status: "completed", summary: "done" }) },
  ]
  const newestPage = rebuildBlocks(newer)
  assert.deepEqual(newestPage.map(block => block.id), ["u2", "turn-2"], "orphans never render as a turn")
  assert.equal(collectOrphans(newestPage).length, 2)

  // Hosts that rebuild everything they hold get the attachment directly ...
  const merged = rebuildBlocks([...older, ...newer])
  assert.equal(square(merged, "toolu_agent").children?.length, 1)
  assert.equal(square(merged, "toolu_agent").task?.status, "completed")
  // ... and hosts that stitch separately rebuilt spans resolve the parked parts.
  const stitched = resolveBackgroundOrphans([...rebuildBlocks(older), ...newestPage])
  assert.deepEqual(shape(stitched), shape(merged))
  assert.equal(collectOrphans(stitched).length, 0)
  // Hosts that route background records out of their spans attach them once at the end.
  const all = [...older, ...newer]
  const routed = attachBackgroundRecords(rebuildBlocks(all.filter(record => !isBackgroundRecord(record))), all)
  assert.deepEqual(shape(routed), shape(merged))
})

test("nested agents attach through their parents and a nested task folds into the child that launched it", () => {
  const messages = apply([],
    agentUse("toolu_agent"),
    childUse("toolu_inner_agent", "toolu_agent", "Agent"),
    childUse("toolu_shell", "toolu_inner_agent"),
    taskEvent("toolu_shell", "shell-1", "running", { kind: "shell", parentTaskId: "agent-2" }),
  )
  const inner = square(messages, "toolu_inner_agent")
  assert.equal(inner.children?.[0]?.toolUseId, "toolu_shell")
  assert.equal(inner.children?.[0]?.task?.status, "running")
  assert.equal(findLaunchingSquare(messages, "toolu_shell")?.toolUseId, "toolu_agent")
  assert.equal(indexBackgroundTasks(messages).get("shell-1")?.part.toolUseId, "toolu_shell")
})

test("task states fold onto the launching square and a terminal state is never regressed", () => {
  let messages = apply([], agentUse("toolu_agent"), taskEvent("toolu_agent", "t1", "running"))
  assert.equal(square(messages, "toolu_agent").task?.status, "running")
  assert.ok(isBackgroundRunning(square(messages, "toolu_agent")))
  assert.equal(getPartColor(square(messages, "toolu_agent")), PART_COLOR.delegation)

  messages = apply(messages, taskEvent("toolu_agent", "t1", "completed", { summary: "sub done", usage: { toolUses: 2 } }))
  messages = apply(messages, taskEvent("toolu_agent", "t1", "running"))
  const settled = square(messages, "toolu_agent")
  assert.equal(settled.task?.status, "completed")
  assert.equal(settled.task?.summary, "sub done")
  assert.ok(!isBackgroundRunning(settled))
  assert.equal(getPartColor(settled), PART_COLOR.delegation, "completed is solid in the delegation colour")

  for (const [status, color] of [["stopped", PART_COLOR.error], ["failed", PART_COLOR.error], ["lost", PART_COLOR.fallback]] as const) {
    const ended = square(apply([], agentUse("toolu_x"), taskEvent("toolu_x", "tx", status)), "toolu_x")
    assert.equal(getPartColor(ended), color, status)
  }
  const shell = square(apply([], { ...childUse("toolu_bg_shell", "", "Bash"), parentToolUseId: null },
    taskEvent("toolu_bg_shell", "s1", "stopped", { kind: "shell" })), "toolu_bg_shell")
  assert.equal(getPartColor(shell), PART_COLOR.error, "background shells get the same states")
})

test("background work never moves turn-level state", () => {
  const live: MessageBlock[] = apply([], { type: "text", content: "Working", messageUid: "turn-2", timestamp: ts })
  for (const isStreaming of [false, true]) {
    const result = processStreamEvent(live, isStreaming, childUse("toolu_child_q", "toolu_agent", "AskUserQuestion"))
    assert.equal(result.isStreaming, isStreaming)
    assert.equal(result.background, true)
    assert.equal(result.pendingQuestion, null, "a subagent's question is not the turn's")
    assert.equal(result.messages.filter(block => block.role === "assistant").length, 1)
    assert.equal(result.messages[0].parts.length, 1)
  }
  // The main spinner reads the turn's own parts only.
  const withChild = apply([], { type: "thinking", content: "t", messageUid: "turn-1", messageId: "m:0", isPartial: false, timestamp: ts },
    agentUse("toolu_agent"), childUse("toolu_child", "toolu_agent"))
  assert.equal(getSpinnerColor(withChild), PART_COLOR.delegation)
})

test("unknown event and record types are skipped instead of rendered", () => {
  const before = apply([], { type: "text", content: "hi", messageUid: "turn-1", timestamp: ts })
  const result = processStreamEvent(before, true, { type: "future_kind" as ChatEvent["type"], content: "x", messageUid: "turn-1" })
  assert.equal(result.messages, before)
  assert.equal(result.isStreaming, true)
  const blocks = rebuildBlocks([
    { id: 1, role: "assistant", eventType: "text", content: "hi", messageUid: "turn-1", timestamp: ts },
    { id: 2, role: "assistant", eventType: "future_kind", content: "x", messageUid: "turn-1", timestamp: ts },
  ])
  assert.deepEqual(blocks[0].parts.map(part => part.type), ["text"])
})

test("results pair by tool-call id when calls interleave and fall back to position without ids", () => {
  const useA: MessagePart = { type: "tool_use", toolName: "Read", toolUseId: "a", content: "" }
  const useB: MessagePart = { type: "tool_use", toolName: "Read", toolUseId: "b", content: "" }
  const resultB: MessagePart = { type: "tool_result", toolUseId: "b", content: "B" }
  const resultA: MessagePart = { type: "tool_result", toolUseId: "a", content: "A" }
  assert.equal(findPairedResult([useA, useB, resultB, resultA], useA), resultA)
  assert.equal(findPairedResult([useA, useB, resultB, resultA], useB), resultB)
  const legacyUse: MessagePart = { type: "tool_use", toolName: "Read", content: "" }
  const legacyResult: MessagePart = { type: "tool_result", content: "L" }
  assert.equal(findPairedResult([legacyUse, legacyResult], legacyUse), legacyResult)
  assert.equal(findPairedResult([useA, resultB], useA), undefined, "a result naming another call is not this call's")
})

test("tool calls keep their native identity on both paths", () => {
  const live = apply([], agentUse("toolu_agent"), { type: "tool_result", toolResult: "launched", messageId: "toolu_agent", messageUid: "turn-1" })
  const history = rebuildBlocks([
    { id: 1, role: "assistant", eventType: "tool_use", toolName: "Agent", messageId: "toolu_agent", messageUid: "turn-1", timestamp: ts },
    { id: 2, role: "assistant", eventType: "tool_result", toolResult: "launched", messageId: "toolu_agent", messageUid: "turn-1", timestamp: ts },
  ])
  for (const blocks of [live, history]) {
    assert.deepEqual(blocks[0].parts.map(part => [part.toolUseId, part.messageId]), [["toolu_agent", "toolu_agent"], ["toolu_agent", "toolu_agent"]])
  }
})

test("a self-started turn carries its origin live and from history", () => {
  const origin = { kind: "background-task", taskId: "t1" }
  const live = apply([], { type: "text", content: "noted", messageUid: "wake", turnOrigin: origin, timestamp: ts })
  assert.deepEqual(turnOriginOf(live[0]), origin)
  const history = rebuildBlocks([
    { id: 1, role: "assistant", eventType: "text", content: "noted", messageUid: "wake", turnOrigin: origin, timestamp: ts },
  ])
  assert.deepEqual(turnOriginOf(history[0]), origin)
  // The closing status alone also marks the turn (a client that missed the first event).
  const late = processStreamEvent(apply([], { type: "text", content: "noted", messageUid: "wake2", timestamp: ts }), true,
    { type: "status", content: "idle", turnOrigin: origin }).messages
  assert.deepEqual(turnOriginOf(late[0]), origin)
})

test("Claude Agent and Task squares take the agent colour, like Leaf agent tools", () => {
  for (const name of ["Agent", "Task", "agent:research"])
    assert.equal(getToolActivityCategory(name), "agent", name)
  assert.equal(getToolActivityCategory("Read"), "read-only")
})

test("status wording counts what runs and warns what an interrupt stops", () => {
  assert.equal(describeBackgroundCount([{ kind: "agent" }, { kind: "agent" }]), "2 agents")
  assert.equal(describeBackgroundCount([{ kind: "agent" }, { kind: "shell" }]), "1 agent · 1 shell")
  assert.equal(backgroundStopWarning([{ kind: "agent" }, { kind: "agent" }]), "also stops 2 background agents")
  assert.equal(backgroundStopWarning([{ kind: "agent" }, { kind: "shell" }]), "also stops 2 background tasks")
  assert.equal(backgroundStopWarning([]), null)
})

test("parked parts survive on block metadata only and attachBackground is a no-op without work", () => {
  const blocks: MessageBlock[] = [{ id: "a", role: "assistant", parts: [{ type: "text", content: "x" }], timestamp: ts }]
  assert.equal(attachBackground(blocks, []), blocks)
  const parked = attachBackground(blocks, [backgroundPart({ type: "tool_use", messageId: "c", parentToolUseId: "missing" })])
  assert.equal((parked[0].metadata?.[BACKGROUND_ORPHANS_KEY] as MessagePart[]).length, 1)
  assert.deepEqual(parked[0].parts, blocks[0].parts)
})

test("activity row: agents lead, then other tasks, then host work; each group oldest first", async () => {
  const { orderBackgroundActivity, runningBackgroundTasks, summarizeBackgroundActivity } = await import("./background-work.ts")
  const tasks = [
    { taskId: "shell", kind: "shell", status: "running", startedAt: "2026-10-22T09:00:01Z", lastActivity: "npm test" },
    { taskId: "late-agent", kind: "agent", status: "running", startedAt: "2026-10-22T09:00:09Z", lastActivity: "Running Read" },
    { taskId: "done", kind: "agent", status: "completed", startedAt: "2026-10-22T09:00:00Z" },
    { taskId: "early-agent", kind: "agent", startedAt: "2026-10-22T09:00:05Z", lastActivity: "Running Echo alpha" },
    { taskId: "monitor", kind: "other", status: "running", startedAt: "2026-10-22T09:00:00Z" },
  ]
  const running = runningBackgroundTasks(tasks)
  assert.deepEqual(running.map(task => task.taskId), ["shell", "late-agent", "early-agent", "monitor"])
  assert.deepEqual(orderBackgroundActivity(running).map(task => task.taskId), ["early-agent", "late-agent", "monitor", "shell"])
  const host = { label: "1 delegation running…", title: "Delegations" }
  // Agents own the text, described alone; other work keeps only its shape.
  assert.deepEqual(summarizeBackgroundActivity(running, host),
    { source: "agents", label: "2 agents working", detail: "Running Echo alpha" })
  // Without agents, the remaining background tasks lead.
  assert.deepEqual(summarizeBackgroundActivity(running.filter(task => task.kind !== "agent"), host),
    { source: "tasks", label: "1 shell · 1 task working" })
  assert.deepEqual(summarizeBackgroundActivity([tasks[0]], host),
    { source: "tasks", label: "1 shell working", detail: "npm test" })
  // Host work only speaks when nothing else runs.
  assert.deepEqual(summarizeBackgroundActivity([], host), { source: "host", label: "1 delegation running…", title: "Delegations" })
  assert.equal(summarizeBackgroundActivity([], null), null)
  assert.equal(summarizeBackgroundActivity([], { label: "" }), null)
})
