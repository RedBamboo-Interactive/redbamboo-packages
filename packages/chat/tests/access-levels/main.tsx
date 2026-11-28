import React, { useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { Toaster } from "@redbamboo/ui"
import { ChatPanel } from "../../src/components/chat-panel"
import { SessionInfoButton } from "../../src/components/context-indicator"
import { processStreamEvent } from "../../src/lib/process-stream-event"
import type { AccessLevel, ChatEvent, MessageBlock, PermissionDecisionPayload, QuestionState, SessionConfigChange, SessionInferenceChange, SessionInferenceOptions, SessionInferenceSettingsClient, SessionNodeSettings, SessionNodeSettingsClient, SessionStats } from "../../src/types"
import "./fixture.css"

// ?view=modal: the Info button and modal. &level= current level, &supported=plan,ask,... , &cap=, &full=off,
// &refuse=1 makes every level change fail with the server's words.
// ?view=chat: a ChatPanel fed through processStreamEvent. &scenario=permission|ask|unanchored,
// &refuseDecision=1 makes the first decision fail.
declare global {
  interface Window {
    __decisions: PermissionDecisionPayload[]
    __changes: SessionConfigChange[]
    __inferenceChanges: { id: string; change: SessionInferenceChange }[]
    __emit: (event: ChatEvent) => void
    __settleInference: () => void
    __settleNodeMove: () => void
    __nodeChanges: Array<{ phase: string; id: string; generation: number; node: string; key: string }>
  }
}
window.__decisions = []
window.__changes = []
window.__inferenceChanges = []
const params = new URLSearchParams(location.search)
const view = params.get("view") ?? "modal"
const stamp = "2026-11-09T10:00:00.000Z"

let inference: SessionInferenceOptions = {
  provider: params.get("retiredProvider") === "1" ? "opencode" : "claude-code",
  providers: [
    { id: "claude-code", name: "Claude Code" },
    ...(params.get("singleProvider") === "1" ? [] : [{ id: "codex", name: "Codex" }]),
  ],
  model: "first-model",
  effort: "high",
  models: [
    { id: "first-model", name: "First model", supportedEfforts: ["low", "high"] },
    { id: "second-model", name: "Second model with an unusually long provider display name", supportedEfforts: ["medium", "xhigh"] },
  ],
}
const inferenceListeners = new Set<() => void>()
window.__settleInference = () => {
  const pending = inference.pendingChanges?.[0]
  if (!pending) return
  inference = {
    ...inference,
    provider: pending.provider ?? inference.provider,
    model: pending.model ?? inference.model,
    effort: pending.effort ?? inference.effort,
    pendingChanges: [],
  }
  for (const listener of inferenceListeners) listener()
}
const subscribeInferenceSettings = (listener: () => void) => {
  inferenceListeners.add(listener)
  return () => { inferenceListeners.delete(listener) }
}

const inferenceSettingsClient: SessionInferenceSettingsClient = {
  load: async () => inference,
  set: async (id, change) => {
    window.__inferenceChanges.push({ id, change })
    if (change.effort === "xhigh") throw new Error("This session has pending input.")
    if (params.get("queueInference") === "1") {
      inference = { ...inference, pendingChanges: [{ id: "settings-1", state: "pending", ...change }] }
      return inference
    }
    inference = { ...inference, ...change, effort: change.model ? "medium" : change.effort ?? inference.effort }
    return inference
  },
}

const localNode = { nodeId: "local", name: "This computer" }
const leafUbuntu = { nodeId: "ubuntu", name: "LeafUbuntu",
  sessionRuntime: { id: "sessions", workspace: "fixture", revision: "pinned", providerInstanceId: "probe" } }
let placement: SessionNodeSettings = {
  active: leafUbuntu, generation: 1, state: "held", reason: "node_unavailable", canMove: true, destinations: [localNode],
}
let nodeMoveSettled = false
window.__nodeChanges = []
window.__settleNodeMove = () => {
  placement = { active: localNode, generation: 2, state: "idle", canMove: true, destinations: [leafUbuntu] }
  nodeMoveSettled = true
  for (const listener of inferenceListeners) listener()
}
const nodeSettingsClient: SessionNodeSettingsClient = {
  load: async () => placement,
  preview: async (id, generation, destination, key) => {
    window.__nodeChanges.push({ phase: "preview", id, generation, node: destination.nodeId, key })
  },
  move: async (id, generation, destination, key) => {
    window.__nodeChanges.push({ phase: "apply", id, generation, node: destination.nodeId, key })
    if (params.get("loseNodeReply") === "1" && window.__nodeChanges.filter(change => change.phase === "apply").length === 1)
      throw new Error("Connection interrupted. Retry the same change.")
    return { id: "node-operation", state: "pending" }
  },
  receipt: async (_session, id) => ({ id, state: nodeMoveSettled ? "delivered" : "pending" }),
}

function ModalFixture() {
  const [stats, setStats] = useState<SessionStats>({
    sessionId: "session-1",
    provider: "claude-code",
    model: "claude-opus-5-5",
    status: "active",
    qualityTier: "high",
    accessLevel: (params.get("level") ?? "ask") as AccessLevel,
    supportedAccessLevels: (params.get("supported") ?? "plan,ask,auto,full").split(",") as AccessLevel[],
    maxAccessLevel: (params.get("cap") || null) as AccessLevel | null,
  })
  const onConfigChange = async (change: SessionConfigChange) => {
    window.__changes.push(change)
    await new Promise(resolve => setTimeout(resolve, 50))
    if (params.get("refuse") === "1") throw new Error("Raising the access level needs you to be present.")
    if (change.accessLevel) setStats(current => ({ ...current, accessLevel: change.accessLevel }))
  }
  return (
    <div className="flex items-center justify-end gap-2 border-b border-overlay-10 p-2">
      <SessionInfoButton
        stats={stats}
        messages={[]}
        inferenceSettingsClient={params.get("inference") === "1" ? inferenceSettingsClient : undefined}
        nodeSettingsClient={params.get("nodeMove") === "1" ? nodeSettingsClient : undefined}
        subscribeInferenceSettings={subscribeInferenceSettings}
        providerOptions={params.get("sharedProviderMetadata") === "1" ? [
          { value: "different-record-id", aliases: ["claude-code", "codex"], label: "Shared display label", icon: "ph-bold ph-cube" },
        ] : [
          { value: "anthropic-direct", aliases: ["claude-code"], label: "Claude Code", icon: "ph-bold ph-sparkle", color: "#d97757" },
          { value: "codex-default", aliases: ["codex"], label: "Codex", icon: "ph-bold ph-terminal", color: "#10a37f" },
          { value: "opencode-default", aliases: ["opencode"], label: "OpenCode" },
          { value: "other-provider", label: "Unavailable provider", icon: "ph-bold ph-cube" },
        ]}
        qualityTierOptions={[
          { value: "high", label: "High", color: "#a78bfa", icon: "ph-bold ph-lightning" },
          { value: "low", label: "Low", color: "#38bdf8", icon: "ph-bold ph-feather" },
        ]}
        {...(params.get("host") === "level-only"
          ? { onAccessLevelChange: (accessLevel: AccessLevel) => onConfigChange({ accessLevel }) }
          : { onConfigChange })}
        onAccessCapRaise={params.get("raiseCap") === "1" ? async cap => {
          setStats(current => ({ ...current, maxAccessLevel: cap }))
        } : undefined}
        fullAccessEnabled={params.get("full") !== "off"}
        fullAccessSettingsHref="#/settings/agent-permissions"
      />
    </div>
  )
}

const base = { content: null, toolName: null, toolInput: null, toolResult: null, messageId: null, messageUid: null }
const bashInput = JSON.stringify({ command: "git clean -fdx && rm -rf node_modules/.cache/some/very/long/path/that/wraps/on/a/phone" })
const askInput = JSON.stringify({ questions: [{ question: "Which branch should I clean?", header: "Branch", multiSelect: false, options: [{ label: "main" }, { label: "dev" }] }] })

function ChatFixture() {
  const scenario = params.get("scenario") ?? "permission"
  const [state, setState] = useState<{ messages: MessageBlock[]; isStreaming: boolean; question: QuestionState }>({
    messages: [{ id: "user-1", role: "user", timestamp: stamp, parts: [{ type: "text", content: "Clean the build please" }] }],
    isStreaming: true,
    question: { pending: null, outcome: null },
  })
  const stateRef = useRef(state)
  stateRef.current = state
  const emit = (event: ChatEvent) => {
    const current = stateRef.current
    const result = processStreamEvent(current.messages, true, { timestamp: stamp, ...event }, false, current.question)
    const next = { messages: result.messages, isStreaming: result.isStreaming, question: result.question }
    stateRef.current = next
    setState(next)
  }
  window.__emit = emit

  const decide = async (payload: PermissionDecisionPayload) => {
    window.__decisions.push(payload)
    await new Promise(resolve => setTimeout(resolve, 50))
    if (params.get("refuseDecision") === "1" && window.__decisions.length === 1)
      throw new Error("Approving needs you to be present.")
    emit({ ...base, type: "question_resolved", content: payload.decision, requestId: payload.requestId })
  }

  React.useEffect(() => {
    emit({ ...base, type: "text", content: "Cleaning the build first.", messageId: "msg-1" })
    if (scenario === "ask") {
      emit({ ...base, type: "tool_use", toolName: "AskUserQuestion", toolInput: askInput, messageId: "toolu_ask" })
      emit({ ...base, type: "question", toolName: "AskUserQuestion", toolInput: askInput, messageId: "toolu_ask", requestId: "q1" })
      return
    }
    emit({ ...base, type: "tool_use", toolName: "Read", toolInput: JSON.stringify({ file_path: "package.json" }), messageId: "toolu_read" })
    emit({ ...base, type: "tool_result", content: "{}", toolResult: "{}", messageId: "toolu_read" })
    if (scenario !== "unanchored")
      emit({ ...base, type: "tool_use", toolName: "Bash", toolInput: bashInput, messageId: "toolu_bash" })
    emit({
      ...base,
      type: "question",
      kind: "permission",
      requestId: "req-1",
      toolName: "Bash",
      toolInput: bashInput,
      messageId: scenario === "unanchored" ? "toolu_not_streamed" : "toolu_bash",
      permission: {
        toolName: "Bash",
        toolUseId: scenario === "unanchored" ? "toolu_not_streamed" : "toolu_bash",
        summary: JSON.parse(bashInput).command,
        input: JSON.parse(bashInput),
        cwd: "T:/Projects/demo",
        options: ["allow_once", "allow_session", "deny"],
      },
    })
  }, [])

  return (
    <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column" }}>
      <ChatPanel
        messages={state.messages}
        isStreaming={state.isStreaming}
        sessionId="access-levels"
        persistQueue={false}
        pendingQuestion={state.question.pending}
        questionOutcome={state.question.outcome}
        permissionApprovals={state.question.permissions ?? null}
        onPermissionDecision={decide}
        onAnswerQuestion={() => {}}
      />
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <>{view === "chat" ? <ChatFixture /> : <ModalFixture />}<Toaster /></>,
)
