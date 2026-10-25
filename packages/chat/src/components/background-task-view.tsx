import { createContext, useContext, useEffect, useState } from "react"
import { Button } from "@redbamboo/ui"
import type { BackgroundTaskInfo, BackgroundTaskState, MessagePart, TurnOrigin } from "../types"
import { PART_COLOR, getPartColor, isBackgroundRunning } from "../lib/part-colors"
import { getEffectiveToolName } from "../lib/tool-semantics"

/**
 * Panel-wide background work state shared with every message row without
 * threading props through the memoised rows.
 */
export interface BackgroundWorkContextValue {
  /** Present only when the host can stop a task (the capability). */
  onStopBackgroundTask?: (taskId: string) => Promise<void> | void
  /** Ask the row that owns a launching square to open its details. */
  requestOpen: (toolUseId: string) => void
  /** The latest open request; rows react when it names one of their squares. */
  openRequest: { toolUseId: string; nonce: number } | null
  /** Task id -> launching part, for labels that only know a task id. */
  tasks: ReadonlyMap<string, { task: BackgroundTaskState; part: MessagePart }>
  /** Live progress by task id, from the session's background task list. */
  live: ReadonlyMap<string, BackgroundTaskInfo>
}

export const BackgroundWorkContext = createContext<BackgroundWorkContextValue>({
  requestOpen: () => {},
  openRequest: null,
  tasks: new Map(),
  live: new Map(),
})

export function useBackgroundWork(): BackgroundWorkContextValue {
  return useContext(BackgroundWorkContext)
}

const STATUS_LABEL: Record<string, string> = {
  running: "Running",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  lost: "Lost",
}

const STATUS_CLASS: Record<string, string> = {
  running: "bg-pink-500/15 text-pink-300",
  completed: "bg-overlay-6 text-text-muted",
  failed: "bg-red-500-a20 text-red-300",
  stopped: "bg-red-500-a20 text-red-300",
  lost: "bg-overlay-6 text-text-disabled",
}

export function taskTitle(task: Pick<BackgroundTaskState, "kind" | "description" | "agentType">): string {
  return task.description || task.agentType || (task.kind === "shell" ? "Background shell" : "Background agent")
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return ""
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

/** Re-render once a second while a task runs so its duration counts up. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

/** Status, duration, tool count and summary of the task a square launched, with Stop while it runs. */
export function BackgroundTaskPanel({ part }: { part: MessagePart }) {
  const { onStopBackgroundTask, live } = useBackgroundWork()
  const task = part.task
  const running = task?.status === "running"
  const now = useNow(running)
  const [stopping, setStopping] = useState(false)
  const [stopError, setStopError] = useState<string | null>(null)
  if (!task) return null

  const progress = live.get(task.taskId)
  const started = task.startedAt ? Date.parse(task.startedAt) : NaN
  const ended = task.endedAt ? Date.parse(task.endedAt) : running ? now : NaN
  const duration = task.usage?.durationMs ?? (Number.isFinite(started) && Number.isFinite(ended) ? ended - started : NaN)
  const toolUses = task.usage?.toolUses ?? progress?.usage?.toolUses
    ?? part.children?.filter(child => child.type === "tool_use").length
  const stop = async () => {
    if (!onStopBackgroundTask) return
    setStopping(true)
    setStopError(null)
    try { await onStopBackgroundTask(task.taskId) }
    catch (error) { setStopError(error instanceof Error ? error.message : "Stop failed") }
    finally { setStopping(false) }
  }

  return (
    <div data-slot="background-task-panel" data-task-status={task.status} className="mb-3 rounded-md border border-border-subtle bg-overlay-3 px-3 py-2 space-y-1.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${STATUS_CLASS[task.status] ?? STATUS_CLASS.completed}`}>
          {STATUS_LABEL[task.status] ?? task.status}
        </span>
        <span className="text-xs text-text-muted">{task.kind === "shell" ? "Background shell" : "Background agent"}</span>
        {Number.isFinite(duration) && <span className="text-[10px] font-mono text-text-disabled">{formatDuration(duration)}</span>}
        {typeof toolUses === "number" && toolUses > 0 && (
          <span className="text-[10px] font-mono text-text-disabled">{toolUses} {toolUses === 1 ? "tool call" : "tool calls"}</span>
        )}
        {running && onStopBackgroundTask && (
          <Button variant="destructive" size="xs" className="ml-auto" onClick={stop} disabled={stopping}
            aria-label={`Stop ${taskTitle(task)}`} title="Stop this background task (the session keeps running)">
            <i className={`ph-bold ${stopping ? "ph-spinner animate-spin" : "ph-stop"} text-[10px]`} />
            Stop
          </Button>
        )}
      </div>
      {running && progress?.lastActivity && (
        <p className="text-xs text-text-muted">{progress.lastActivity}</p>
      )}
      {task.summary && !running && (
        <p className="text-xs text-text-secondary whitespace-pre-wrap">{task.summary}</p>
      )}
      {task.status === "lost" && (
        <p className="text-xs text-text-disabled">The provider process ended while this task was running.</p>
      )}
      {stopError && <p className="text-xs text-red-300">{stopError}</p>}
    </div>
  )
}

export function childLabel(part: MessagePart): string {
  switch (part.type) {
    case "thinking": return "Thinking"
    case "text": return "Commentary"
    case "tool_use": return getEffectiveToolName(part.toolName, part.toolInput) || "Tool"
    default: return part.type
  }
}

/** The squares of the work a background agent did, inside its launching square's details. */
export function ChildFrieze({ parts, selected, onSelect }: {
  parts: readonly MessagePart[]
  selected?: MessagePart
  onSelect: (part: MessagePart) => void
}) {
  const squares = parts.filter(part => part.type !== "tool_result")
  if (squares.length === 0) return null
  return (
    <div className="mb-3">
      <div className="text-[10px] uppercase text-text-muted mb-1.5 font-semibold">Activity</div>
      <div role="group" aria-label="Background activity" className="flex flex-wrap items-center gap-[3px] py-1 px-0.5">
        {squares.map((part, index) => (
          <button
            key={part.toolUseId ?? `${part.type}:${index}`}
            type="button"
            onClick={() => onSelect(part)}
            className={`w-2.5 h-2.5 rounded-[2px] transition-colors duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer${isBackgroundRunning(part) ? " square-jiggle" : ""}${part === selected ? " ring-1 ring-contrast" : ""}`}
            style={{ backgroundColor: getPartColor(part) }}
            title={childLabel(part)}
            aria-label={childLabel(part)}
            data-tool-use-id={part.toolUseId}
            data-task-status={part.task?.status}
          />
        ))}
      </div>
    </div>
  )
}

/** The delegation-coloured event circle opening a turn the provider started because a background task finished. */
/** The origin circle alone, for placement inside an activity frieze. */
export function TurnOriginDot({ origin }: { origin: TurnOrigin }) {
  const { tasks, requestOpen } = useBackgroundWork()
  const entry = origin.taskId ? tasks.get(origin.taskId) : undefined
  const label = entry
    ? `${taskTitle(entry.task)} ${entry.task.status === "stopped" ? "stopped" : entry.task.status === "failed" ? "failed" : "finished"}`
    : "A background task finished"
  const toolUseId = entry?.part.toolUseId
  return (
    <button
      type="button"
      data-slot="turn-origin"
      onClick={() => toolUseId && requestOpen(toolUseId)}
      className="w-2.5 h-2.5 rounded-full transition-colors duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer square-spawn"
      style={{ backgroundColor: PART_COLOR.delegation }}
      title={label}
      aria-label={label}
    />
  )
}

export function TurnOriginMarker({ origin }: { origin: TurnOrigin }) {
  return (
    <div className="flex items-center gap-[3px] py-1.5 px-0.5">
      <TurnOriginDot origin={origin} />
    </div>
  )
}
