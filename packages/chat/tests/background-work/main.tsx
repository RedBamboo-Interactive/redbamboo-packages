import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { ChatPanel } from "../../src/components/chat-panel"
import { rebuildBlocks, type PersistedMessage } from "../../src/lib/rebuild-blocks"
import type { ActivityStatusGroup, BackgroundTaskInfo } from "../../src/types"
import "./fixture.css"

// Background work fixture: Agent squares in every task state, a running
// background shell, a subagent's own calls under its square, a turn the
// provider started after a task finished, and the one activity row with
// host-owned work (delegations) after the background tasks.
// The transcript is built through rebuildBlocks, exactly as hosts load history.

const ts = (second: number) => `2026-10-22T09:0${Math.floor(second / 60)}:${String(second % 60).padStart(2, "0")}Z`
let sequence = 0
const record = (fields: Partial<PersistedMessage> & Pick<PersistedMessage, "role" | "eventType">, second = sequence): PersistedMessage => ({
  id: ++sequence, epoch: "fixture", sequence, timestamp: ts(second), ...fields,
})
const agent = (id: string, description: string, agentType = "general-purpose") => [
  record({ role: "assistant", eventType: "tool_use", toolName: "Agent", messageId: id, messageUid: "turn-1",
    toolInput: JSON.stringify({ description, subagent_type: agentType, prompt: `Do: ${description}`, run_in_background: true }) }),
  record({ role: "assistant", eventType: "tool_result", messageId: id, messageUid: "turn-1", toolResult: "Async agent launched successfully." }),
]
const task = (parent: string, taskId: string, status: string, extra: Record<string, unknown> = {}) =>
  record({ role: "system", eventType: "task", messageId: taskId, messageUid: "turn-1", parentToolUseId: parent,
    toolInput: JSON.stringify({ taskId, kind: "agent", status, description: extra.description ?? taskId, agentType: "general-purpose", startedAt: ts(5), ...extra }) })
const child = (parent: string, id: string, toolName: string, input: Record<string, unknown>, result: string) => [
  record({ role: "assistant", eventType: "tool_use", toolName, messageId: id, messageUid: "turn-1", parentToolUseId: parent, toolInput: JSON.stringify(input) }),
  record({ role: "assistant", eventType: "tool_result", messageId: id, messageUid: "turn-1", parentToolUseId: parent, toolResult: result }),
]

const records: PersistedMessage[] = [
  record({ role: "user", eventType: "text", messageUid: "user-1", content: "Research the mail options in the background and keep going." }),
  ...agent("toolu_research", "Research Gmail API access options"),
  task("toolu_research", "task-research", "running", { description: "Research Gmail API access options" }),
  ...child("toolu_research", "toolu_r1", "WebSearch", { query: "Gmail API service account" }, "Results: ..."),
  ...child("toolu_research", "toolu_r2", "Bash", { command: "echo alpha", description: "Echo alpha" }, "alpha"),
  ...child("toolu_research", "toolu_r3", "Read", { file_path: "T:/Projects/leaf-mail/README.md" }, "# Leaf Mail"),
  ...agent("toolu_map", "Map Leaf extension architecture", "Explore"),
  task("toolu_map", "task-map", "running", { description: "Map Leaf extension architecture" }),
  task("toolu_map", "task-map", "completed", { description: "Map Leaf extension architecture", summary: "Extensions are RedLeaf plugins with a manifest.", endedAt: ts(40), usage: { toolUses: 2, durationMs: 35000 } }),
  ...child("toolu_map", "toolu_m1", "Glob", { pattern: "**/plugin.json" }, "plugins/a/plugin.json"),
  ...agent("toolu_stopped", "Security review of leaf-mail"),
  task("toolu_stopped", "task-stopped", "stopped", { description: "Security review of leaf-mail", endedAt: ts(30) }),
  ...agent("toolu_lost", "Sleep then reply"),
  task("toolu_lost", "task-lost", "lost", { description: "Sleep then reply", endedAt: ts(31) }),
  record({ role: "assistant", eventType: "tool_use", toolName: "Bash", messageId: "toolu_shell", messageUid: "turn-1",
    toolInput: JSON.stringify({ command: "sleep 55 && echo done", run_in_background: true }) }),
  record({ role: "assistant", eventType: "tool_result", messageId: "toolu_shell", messageUid: "turn-1", toolResult: "Command running in background" }),
  record({ role: "system", eventType: "task", messageId: "task-shell", messageUid: "turn-1", parentToolUseId: "toolu_shell",
    toolInput: JSON.stringify({ taskId: "task-shell", kind: "shell", status: "running", description: "Sleep then echo", startedAt: ts(6) }) }),
  record({ role: "assistant", eventType: "text", messageUid: "turn-1", phase: "final_answer", content: "Both agents are running. I will report when they finish." }),
  record({ role: "assistant", eventType: "text", messageUid: "wake-1", phase: "final_answer", content: "The architecture map is done: extensions are RedLeaf plugins.",
    turnOrigin: { kind: "background-task", taskId: "task-map" } }),
]

const backgroundTasks: BackgroundTaskInfo[] = [
  { taskId: "task-research", kind: "agent", status: "running", description: "Research Gmail API access options",
    startedAt: ts(5), lastActivity: "Running Echo alpha", lastToolName: "Bash", parentToolUseId: "toolu_research",
    usage: { toolUses: 3, tokens: 21000, durationMs: 9000 } },
  { taskId: "task-shell", kind: "shell", status: "running", description: "Sleep then echo", startedAt: ts(6),
    parentToolUseId: "toolu_shell" },
]

// Host-owned work, as Nova passes its delegations: circles after the tasks.
const delegation = (key: string, title: string, running: boolean) => ({
  key, title: "Delegation", label: `${title}: ${running ? "running" : "waiting to resume"}`,
  color: "rgb(236 72 153)", shape: "circle" as const, running,
  renderDetails: (close: () => void) => (
    <div data-slot="fixture-delegation">
      <p className="text-sm text-contrast">{title}</p>
      <p className="text-xs text-text-muted">RedLeaf · {running ? "Running" : "Waiting to resume"}</p>
      <button type="button" onClick={close}>Open in Code</button>
    </div>
  ),
})
const hostActivity: ActivityStatusGroup = {
  label: "2 delegations ongoing…",
  icon: "ph-bold ph-code",
  items: [delegation("d1", "Sentinel shield for Discord and Commons", true), delegation("d2", "Pin bump for release builds", false)],
}

declare global { interface Window { __stops: string[] } }
window.__stops = []

function App() {
  const [messages] = useState(() => new URLSearchParams(location.search).has("detached")
    ? rebuildBlocks(records.slice(0, 1)) : rebuildBlocks(records))
  // ?streaming shows the busy composer, whose Stop must warn about the running tasks.
  // ?host adds delegations; ?hostOnly shows delegations with no background task running;
  // ?detached drops the transcript so a task's launching square is not loaded.
  const params = new URLSearchParams(location.search)
  const streaming = params.has("streaming")
  const hostOnly = params.has("hostOnly")
  return <div style={{ width: "100%", height: "100vh" }}>
    <ChatPanel messages={messages} isStreaming={streaming} sessionId="background-work" persistQueue={false}
      backgroundTasks={hostOnly ? [] : backgroundTasks}
      hostActivity={params.has("host") || hostOnly ? hostActivity : null}
      onStopBackgroundTask={taskId => { window.__stops.push(taskId) }} />
  </div>
}

createRoot(document.getElementById("root")!).render(<App />)
