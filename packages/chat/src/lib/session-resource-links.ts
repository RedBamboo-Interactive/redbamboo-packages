export type SessionResourceKind = "job" | "session" | "discussion"

const RESOURCE_PATHS: Record<SessionResourceKind, (id: string) => string> = {
  job: id => `/apps/compute-dashboard/jobs?select=${encodeURIComponent(id)}`,
  session: id => `/apps/codered/sessions/${encodeURIComponent(id)}`,
  discussion: id => `/apps/nova/chat/${encodeURIComponent(id)}`,
}

export function getSessionResourceHref(kind: SessionResourceKind, id: string): string {
  return RESOURCE_PATHS[kind](id)
}
