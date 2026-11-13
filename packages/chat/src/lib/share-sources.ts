// Where a share link comes from. No runtime imports, so node tests load it directly.

export interface ShareInfo {
  active: boolean
  shareId?: string
  url?: string
  sharedAt?: string
}

export interface CreatedShare {
  shareId: string
  url: string
}

/** One conversation's share link: create it, read whether one is active, revoke it. */
export interface ShareSource {
  create(): Promise<CreatedShare>
  info(): Promise<ShareInfo>
  revoke(shareId: string): Promise<void>
}

/** The host's authenticated JSON client; errors reject. */
export interface ShareHttp {
  get<T>(path: string): Promise<T>
  post<T>(path: string, body?: unknown): Promise<T>
  delete<T>(path: string): Promise<T>
}

/** A Nova discussion, shared by its RedLeaf discussion entity. */
export function discussionShareSource(http: ShareHttp, discussionEntityId: string): ShareSource {
  const id = encodeURIComponent(discussionEntityId)
  return {
    create: () => http.post<CreatedShare>("/api/shares", { discussionEntityId }),
    info: () => http.get<ShareInfo>(`/api/shares/info/${id}`),
    revoke: async (shareId) => { await http.delete(`/api/shares/${encodeURIComponent(shareId)}`) },
  }
}

/** A RedCompute session (Code): its text only, never tool output or file contents. */
export function sessionShareSource(http: ShareHttp, sessionId: string): ShareSource {
  const id = encodeURIComponent(sessionId)
  return {
    create: () => http.post<CreatedShare>("/api/shares/session", { sessionId }),
    info: () => http.get<ShareInfo>(`/api/shares/session-info/${id}`),
    revoke: async (shareId) => { await http.delete(`/api/shares/${encodeURIComponent(shareId)}`) },
  }
}

/** The words the dialog shows for a failed share. Known refusals read plainly; anything else keeps the server's message. */
export function shareErrorMessage(error: unknown, fallback: string): string {
  const code = typeof error === "object" && error !== null && "code" in error ? (error as { code?: unknown }).code : undefined
  const status = typeof error === "object" && error !== null && "status" in error ? (error as { status?: unknown }).status : undefined
  if (code === "confidential") return "A confidential conversation can't be shared."
  if (status === 503) return "Sharing isn't set up on this installation."
  return error instanceof Error && error.message ? error.message : fallback
}
