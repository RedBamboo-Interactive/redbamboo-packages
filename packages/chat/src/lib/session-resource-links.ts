export type SessionResourceKind = "job" | "session" | "discussion"

const RESOURCE_PATHS: Record<SessionResourceKind, (id: string) => string> = {
  job: id => `/apps/compute/jobs?select=${encodeURIComponent(id)}`,
  session: id => `/apps/codered/sessions/${encodeURIComponent(id)}`,
  discussion: id => `/apps/nova/chat/${encodeURIComponent(id)}`,
}

export function getSessionResourceHref(kind: SessionResourceKind, id: string): string {
  return RESOURCE_PATHS[kind](id)
}

export function getAgentJobHref(toolName: string | undefined, toolInput: string | undefined): string | undefined {
  if (!toolName?.startsWith("agent:") || !toolInput) return undefined
  try {
    const input = JSON.parse(toolInput) as Record<string, unknown>
    return typeof input.jobId === "string" && input.jobId.trim()
      ? getSessionResourceHref("job", input.jobId)
      : undefined
  } catch {
    return undefined
  }
}
