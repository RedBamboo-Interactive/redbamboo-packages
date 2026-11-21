import { test } from "node:test"
import assert from "node:assert/strict"
import type { MessageBlock, MessagePart } from "../types.ts"
import {
  JOB_CARD_RULES, anchorChatJob, anchorChatJobs, capabilityLabel, describeJobActivity, foldJobRecord,
  formatJobDuration, groupChatJobs, isActiveJob, isExcludedJob, jobElapsed, jobKind,
  jobLaunchIndex, jobProgress, jobStageWords, jobState, jobsByTimelineRow, normalizeChatJob, realProgress, stoppedProgress, type ComputeJobRecord,
} from "./chat-jobs.ts"
import { projectActivityTimeline } from "./activity-timeline.ts"

const at = (second: number) => new Date(Date.UTC(2026, 10, 16, 14, 0, second)).toISOString()
const record = (fields: Partial<ComputeJobRecord> & Pick<ComputeJobRecord, "id">): ComputeJobRecord => ({
  capability: "image-gen", providerName: "ComfyUI", status: "Running", queuedAt: at(10), startedAt: at(10), ...fields,
})
const job = (fields: Partial<ComputeJobRecord> & Pick<ComputeJobRecord, "id">) => normalizeChatJob(record(fields))
const text = (content: string): MessagePart => ({ type: "text", content })
const tool = (toolName = "Bash"): MessagePart => ({ type: "tool_use", toolName, content: "" })
const block = (id: string, role: MessageBlock["role"], second: number, parts: MessagePart[] = [text(id)], uid?: string): MessageBlock => ({
  id, role, timestamp: at(second), parts, ...(uid ? { metadata: { messageUid: uid } } : {}),
})
const deepFreeze = <T>(value: T): T => {
  if (value && typeof value === "object") {
    for (const inner of Object.values(value)) deepFreeze(inner)
    Object.freeze(value)
  }
  return value
}

test("states, kinds and labels follow the job, with a generic fallback", () => {
  assert.deepEqual(["Queued", "Running", "Completed", "Failed", "TimedOut", "Cancelled", "Skipped"].map(jobState),
    ["queued", "running", "done", "failed", "failed", "stopped", "stopped"])
  assert.equal(jobKind("image-gen"), "image")
  assert.equal(jobKind("video-gen"), "video")
  assert.equal(jobKind("music-gen"), "audio")
  assert.equal(jobKind("workflow"), "workflow")
  assert.equal(jobKind("model-download"), "generic")
  assert.equal(jobKind("comfy-run", [{ url: "/x", contentType: "image/png" }]), "image")
  assert.equal(capabilityLabel("model-download"), "Model download")
  assert.equal(capabilityLabel("image-gen"), "Image")
})

test("progress is real only while running and past zero", () => {
  assert.equal(realProgress({ status: "Running", progress: 0 }), null, "0 while waiting for the GPU is not progress")
  assert.equal(realProgress({ status: "Running", progress: 0.62 }), 0.62)
  assert.equal(realProgress({ status: "Queued", progress: 0.5 }), null)
  assert.equal(realProgress({ status: "Completed", progress: 1 }), null)
  assert.equal(realProgress({ status: "Running", progress: null }), null)
  // A cancelled record keeps its last reported progress: the twin shows how far it got.
  assert.equal(stoppedProgress({ status: "Cancelled", progress: 0.42 }), 0.42)
  assert.equal(stoppedProgress({ status: "Skipped", progress: 0 }), null, "stopped before any progress")
  assert.equal(stoppedProgress({ status: "Cancelled", progress: null }), null)
  assert.equal(stoppedProgress({ status: "Running", progress: 0.42 }), null, "only a stopped job")
  assert.equal(normalizeChatJob({ id: "s", capability: "image-gen", status: "Cancelled", progress: 0.42 } as never).stoppedProgress, 0.42)
})

test("exclusions: chat turns, voice lines, dictation and sub-2 s successes; failures always show", () => {
  assert.deepEqual(JOB_CARD_RULES.excludedCapabilities, ["ai-session", "tts", "stt"])
  for (const capability of ["ai-session", "tts", "stt"]) assert.equal(isExcludedJob(record({ id: capability, capability })), true)
  assert.equal(isExcludedJob(record({ id: "ws", capability: undefined, capabilitySlug: "tts" })), true, "frame field name")
  assert.equal(isExcludedJob(record({ id: "fast", status: "Completed", durationMs: 1999 })), true)
  assert.equal(isExcludedJob(record({ id: "slow", status: "Completed", durationMs: 2000 })), false)
  assert.equal(isExcludedJob(record({ id: "fast-fail", status: "Failed", durationMs: 30 })), false)
  assert.equal(isExcludedJob(record({ id: "fast-by-times", status: "Completed", durationMs: null, startedAt: at(10), completedAt: at(11) })), true)
  assert.equal(isExcludedJob(record({ id: "running" })), false)
})

test("normalize keeps outputs with a URL and names the job", () => {
  const normalized = normalizeChatJob(record({
    id: "j1", name: "  Launch covers ", status: "Completed", durationMs: 72000,
    outputs: [{ url: "/out/0", contentType: "image/png", sizeBytes: 3 }, { url: "", contentType: "image/png" }],
  }), { jobHref: id => `/apps/compute/jobs?select=${id}` })
  assert.equal(normalized.title, "Launch covers")
  assert.equal(normalized.provider, "ComfyUI")
  assert.equal(normalized.state, "done")
  assert.equal(normalized.outputs.length, 1)
  assert.equal(normalized.href, "/apps/compute/jobs?select=j1")
  assert.equal(job({ id: "j2", name: null, capability: "music-gen" }).title, "Music")
})

test("fold never regresses a terminal job, so list and refresh deliver one state", () => {
  const done = record({ id: "a", status: "Completed", progress: 1, completedAt: at(40) })
  const stale = record({ id: "a", status: "Running", progress: 0.4 })
  assert.equal(foldJobRecord(done, stale), done)
  const merged = foldJobRecord(stale, done)
  assert.equal(merged.status, "Completed")
  assert.equal(foldJobRecord(undefined, stale), stale)
  const kept = foldJobRecord(record({ id: "a", name: "Covers" }), { id: "a", status: "Running", progress: 0.5 })
  assert.equal(kept.name, "Covers", "a compact read keeps fields it does not carry")
})

test("children fold into a parent in the set; orphans stand alone", () => {
  const parent = job({ id: "p", name: "Covers" })
  const second = job({ id: "c2", parentJobId: "p", queuedAt: at(12) })
  const first = job({ id: "c1", parentJobId: "p", queuedAt: at(11) })
  const orphan = job({ id: "o", parentJobId: "elsewhere" })
  const grouped = groupChatJobs([parent, second, first, orphan])
  assert.deepEqual(grouped.map(item => item.id), ["p", "o"])
  assert.deepEqual(grouped[0].children.map(item => item.id), ["c1", "c2"])
})

test("anchor: the turn active at queuedAt, by its logical messageUid", () => {
  const messages = [
    block("u1", "user", 0),
    block("a1", "assistant", 2, [tool("Bash")], "turn-1"),
    block("a1b", "assistant", 8, [text("Both are on your GPU.")], "turn-1"),
    block("u2", "user", 30),
    block("a2", "assistant", 32, [text("ok")], "turn-2"),
  ]
  assert.deepEqual(anchorChatJob(at(5), messages), { turnKey: "turn-1", blockIndex: 1 })
  assert.deepEqual(anchorChatJob(at(9), messages), { turnKey: "turn-1", blockIndex: 2 })
  assert.deepEqual(anchorChatJob(at(40), messages), { turnKey: "turn-2", blockIndex: 4 })
})

test("anchor: a job queued after a person spoke goes to the turn answering them, or waits for it", () => {
  const messages = [
    block("u1", "user", 0),
    block("a1", "assistant", 2, [text("done")], "turn-1"),
    block("u2", "user", 20),
    block("a2", "assistant", 25, [tool("Bash")], "turn-2"),
  ]
  assert.deepEqual(anchorChatJob(at(21), messages), { turnKey: "turn-2", blockIndex: 3 })
  assert.equal(anchorChatJob(at(21), messages.slice(0, 3)), null, "the answering turn has not arrived yet")
})

test("anchor: work an ended turn left running falls back to the latest agent message", () => {
  const messages = [block("u1", "user", 0), block("a1", "assistant", 2, [text("started")], "turn-1"), block("u2", "user", 60)]
  assert.deepEqual(anchorChatJob(at(30), messages), { turnKey: "turn-1", blockIndex: 1 })
})

test("anchor: ambient event blocks are never anchors", () => {
  const event: MessagePart = { type: "tool_use", toolName: "event:weather", content: "" }
  const messages = [block("u1", "user", 0), block("a1", "assistant", 2, [text("hi")], "turn-1"), block("ev", "assistant", 5, [event])]
  assert.deepEqual(anchorChatJob(at(6), messages), { turnKey: "turn-1", blockIndex: 1 })
})

test("anchor: older than everything loaded (clear, rotation, unloaded page) is no card, until the page loads", () => {
  const tail = [block("u5", "user", 50), block("a5", "assistant", 52, [text("later")], "turn-5")]
  assert.equal(anchorChatJob(at(10), tail), null, "the anchor is on an unloaded older page or in an earlier epoch")
  const older = [block("u1", "user", 0), block("a1", "assistant", 2, [tool()], "turn-1"), ...tail]
  assert.deepEqual(anchorChatJob(at(10), older), { turnKey: "turn-1", blockIndex: 1 }, "appears once its page loads")
  assert.equal(anchorChatJob(at(10), []), null, "a cleared conversation shows no card")
  assert.equal(anchorChatJob("not a date", older), null)
})

test("anchorChatJobs groups a turn's jobs in launch order and leaves the transcript untouched", () => {
  const messages = deepFreeze([
    block("u1", "user", 0),
    block("a1", "assistant", 2, [tool("Bash"), text("Both are on your GPU.")], "turn-1"),
  ])
  const snapshot = JSON.stringify(messages)
  const jobs = deepFreeze([
    job({ id: "theme", capability: "music-gen", queuedAt: at(6), status: "Queued" }),
    job({ id: "covers", queuedAt: at(4) }),
    job({ id: "old", queuedAt: at(-30) }),
  ])
  const anchored = anchorChatJobs(jobs, messages)
  assert.deepEqual(anchored.all.map(item => item.id), ["covers", "theme"])
  assert.deepEqual([...anchored.byTurn.keys()], ["turn-1"])
  assert.deepEqual(anchored.byTurn.get("turn-1")!.jobs.map(item => item.id), ["covers", "theme"])
  assert.equal(JSON.stringify(messages), snapshot, "projection purity: no message is changed")
})

test("activity words: one by name and percentage, several by count", () => {
  const covers = job({ id: "covers", name: "Launch covers", progress: 0.62 })
  const theme = job({ id: "theme", name: "Theme", capability: "music-gen", status: "Queued" })
  const waiting = job({ id: "w", name: "Trailer cut", capability: "video-gen", progress: 0 })
  assert.equal(describeJobActivity([]), null)
  assert.equal(describeJobActivity([covers]), "Launch covers 62%")
  assert.equal(describeJobActivity([waiting]), "Trailer cut")
  assert.equal(describeJobActivity([covers, theme]), "2 jobs · Launch covers 62% · Theme queued")
  assert.equal(describeJobActivity([covers, theme, waiting]), "3 jobs · Launch covers 62% · Theme queued")
  assert.equal(isActiveJob(covers) && isActiveJob(theme), true)
  assert.equal(isActiveJob(job({ id: "d", status: "Completed" })), false)
})

test("children's progress gives the parent one percentage", () => {
  const parent = { ...job({ id: "p", progress: 0 }), children: [
    job({ id: "a", status: "Completed" }), job({ id: "b", progress: 0.5 }), job({ id: "c", status: "Queued" }), job({ id: "d", status: "Queued" }),
  ] }
  assert.equal(jobProgress(parent), 0.375)
  assert.equal(jobProgress(job({ id: "solo", progress: 0 })), null)
})

test("durations, elapsed and stage words", () => {
  assert.equal(formatJobDuration(14_000), "0:14")
  assert.equal(formatJobDuration(72_000), "1:12")
  assert.equal(formatJobDuration(3_725_000), "1:02:05")
  assert.equal(formatJobDuration(null), "")
  const running = job({ id: "r", startedAt: at(10) })
  assert.equal(jobElapsed(running, Date.parse(at(24))), 14_000)
  assert.equal(jobElapsed(job({ id: "q", status: "Queued" }), Date.parse(at(24))), null)
  assert.equal(jobElapsed(job({ id: "d", status: "Completed", durationMs: 48_000 }), 0), 48_000)
  assert.equal(jobStageWords({ state: "running", stage: "waiting" }), "starting up")
  assert.equal(jobStageWords({ state: "queued", stage: "admitted" }), "waiting to start")
  assert.equal(jobStageWords({ state: "done", stage: "completed" }), null)
})

// Twins (89efca37): which rendered row a job's twin joins.
const rowsFor = (messages: MessageBlock[], hide?: (part: MessagePart) => boolean) =>
  projectActivityTimeline(messages, 0, undefined, hide ? part => !hide(part) : undefined)
const placed = (messages: MessageBlock[], jobs: ReturnType<typeof job>[], hide?: (part: MessagePart) => boolean) => {
  const rows = rowsFor(messages, hide)
  const byRow = jobsByTimelineRow(rows, anchorChatJobs(jobs, messages), messages)
  return Object.fromEntries([...byRow].map(([key, list]) => [key, list.map(item => item.id)]))
}

test("twins join the anchored block's last frieze row, in launch order", () => {
  // One block, split by commentary into two friezes: the twin trails the second.
  const messages = [
    block("u1", "user", 0),
    block("a1", "assistant", 2, [tool("Read"), text("Found it."), tool("Bash"), text("Both are on your GPU.")], "turn-1"),
  ]
  assert.deepEqual(placed(messages, [job({ id: "theme", queuedAt: at(6) }), job({ id: "covers", queuedAt: at(4) })]),
    { "activity:a1:2": ["covers", "theme"] })
})

// Placement by launch (89efca37, "within the row, where they were started").
const call = (id: string, toolName = "Bash"): MessagePart => ({ type: "tool_use", toolName, toolUseId: id, content: "" })
const answer = (id: string, content: string): MessagePart => ({ type: "tool_result", toolUseId: id, content })
const GUID = "9b0edfb3-0bb6-49f7-b1be-451f917448e1"

test("a job's launch is the first call whose result names it, by jobId field or printed GUID", () => {
  const parts = [call("t1", "Read"), answer("t1", "brief"), call("t2"), answer("t2", '{"jobId":"covers","status":"running"}'),
    call("t3"), answer("t3", `started ${GUID.toUpperCase()}`), call("t4"), answer("t4", '{"jobId":"covers","status":"completed"}')]
  assert.equal(jobLaunchIndex("covers", parts), 2, "the launch, not the later poll")
  assert.equal(jobLaunchIndex(GUID, parts), 4, "a printed GUID, any case")
  assert.equal(jobLaunchIndex("theme", parts), -1, "no result names it")
  assert.equal(jobLaunchIndex("cover", parts), -1, "a field matches whole, not as a prefix")
  // Without toolUseId, a result answers the nearest call before it.
  assert.equal(jobLaunchIndex("x", [tool("Read"), tool("Bash"), { type: "tool_result", content: '{"job_id":"x"}' }]), 1)
})

test("the launching call beats the clock: a twin joins the row that drew its launch square", () => {
  // Split by commentary into two friezes. covers was launched in the first row; the clock alone would put it in the second.
  const messages = [
    block("u1", "user", 0),
    block("a1", "assistant", 2, [call("t1"), answer("t1", '{"jobId":"covers"}'), text("Rendering."), call("t2"), answer("t2", "ok"), text("Done.")], "turn-1"),
  ]
  assert.deepEqual(placed(messages, [job({ id: "covers", queuedAt: at(4) }), job({ id: "theme", queuedAt: at(5) })]),
    { "activity:a1:0": ["covers"], "activity:a1:3": ["theme"] })
})

test("a launch in another turn's block wins over a queuedAt that skews into the next turn", () => {
  const messages = [
    block("u1", "user", 0),
    block("a1", "assistant", 2, [call("t1"), answer("t1", '{"jobId":"covers"}')], "turn-1"),
    block("u2", "user", 6),
    block("a2", "assistant", 8, [tool("Read")], "turn-2"),
  ]
  assert.deepEqual(placed(messages, [job({ id: "covers", queuedAt: at(9) })]), { "activity:a1:0": ["covers"] })
})

test("a block with no frieze gives its twins to its last content row", () => {
  const messages = [
    block("u1", "user", 0),
    block("a1", "assistant", 2, [text("On it."), text("Started the render.")], "turn-1"),
  ]
  const rows = rowsFor(messages)
  assert.equal(rows.filter(row => row.kind === "activity").length, 0)
  assert.deepEqual(placed(messages, [job({ id: "covers", queuedAt: at(4) })]), { [rows.at(-1)!.key]: ["covers"] })
})

test("hidden markers move nothing but the row that holds the twin; the twin stays", () => {
  const messages = [
    block("u1", "user", 0),
    block("a1", "assistant", 2, [tool("Bash"), text("Started the render.")], "turn-1"),
  ]
  assert.deepEqual(placed(messages, [job({ id: "covers", queuedAt: at(4) })]), { "activity:a1:0": ["covers"] })
  assert.deepEqual(placed(messages, [job({ id: "covers", queuedAt: at(4) })], part => part.toolName === "Bash"), { "message:a1:0": ["covers"] })
})

test("jobs of two turns sharing a merged row keep launch order; unrendered turns show nothing", () => {
  // Two turns with no text between them render as one frieze row.
  const messages = [
    block("u1", "user", 0),
    block("a1", "assistant", 2, [tool("Bash")], "turn-1"),
    block("a2", "assistant", 8, [tool("Bash")], "turn-2"),
  ]
  const jobs = [job({ id: "first", queuedAt: at(3) }), job({ id: "second", queuedAt: at(9) }), job({ id: "between", queuedAt: at(5) })]
  assert.deepEqual(placed(messages, jobs), { "activity:a1:0": ["first", "between", "second"] })
  const anchored = anchorChatJobs(jobs, messages)
  assert.equal(jobsByTimelineRow(projectActivityTimeline(messages.slice(0, 1), 0), anchored, messages).size, 0,
    "a turn outside the rendered rows has no twin")
})
