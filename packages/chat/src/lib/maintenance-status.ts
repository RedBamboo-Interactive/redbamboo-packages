import type { ChatMaintenanceStatus } from "../types"

export function parseMaintenanceStatus(value: unknown): ChatMaintenanceStatus | null {
  if (!value || typeof value !== "object") return null
  const s = value as Record<string, unknown>
  if (!["idle", "draining", "launching", "failed"].includes(String(s.state))
    || s.paused !== (s.state === "draining" || s.state === "launching")
    || !(s.runId === null || typeof s.runId === "string")
    || !(s.startedAt === null || typeof s.startedAt === "string" && Number.isFinite(Date.parse(s.startedAt)))
    || typeof s.changedAt !== "string" || !Number.isFinite(Date.parse(s.changedAt))
    || !(s.activeTurnCount === null || typeof s.activeTurnCount === "number" && Number.isInteger(s.activeTurnCount) && s.activeTurnCount >= 0)) return null
  return { state: s.state as ChatMaintenanceStatus["state"], paused: s.paused as boolean,
    runId: s.runId as string | null, startedAt: s.startedAt as string | null,
    changedAt: s.changedAt, activeTurnCount: s.activeTurnCount as number | null }
}

export function maintenanceNotice(status: ChatMaintenanceStatus | null | undefined, hasSession: boolean, unavailable = false): { title: string; detail: string } | null {
  if (!status || status.state === "idle") return null
  if (unavailable) return status.paused
    ? { title: "Update status unavailable", detail: "The last status showed message delivery paused. Reconnecting to check whether the update finished." }
    : null
  if (status.state === "failed") return { title: "Update could not finish", detail: "Message delivery has resumed. The update has not been confirmed as installed." }
  const saved = hasSession ? "Accepted messages are saved and will send after restart."
    : "New chats cannot start yet. Your draft stays on this device; retry after the update finishes."
  if (status.state === "launching") return { title: "Restarting for an update", detail: saved }
  const count = status.activeTurnCount
  const waiting = count === null ? "Waiting for active conversations to finish."
    : count === 0 ? "Preparing to restart."
    : `Waiting for ${count} active conversation${count === 1 ? "" : "s"} to finish.`
  return { title: "Update pending", detail: `${waiting} Restart follows automatically. ${saved}` }
}
