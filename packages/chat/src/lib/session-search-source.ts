// RedCompute session search (`GET /ai-session/sessions/search`) as a ConversationSearchDialog source.
// No runtime imports, so node tests load it directly.

export interface SessionSearchItem {
  session: { id: string; title?: string | null; projectName?: string | null }
  snippet?: string | null
  messageUid?: string | null
  archived?: boolean
}

/** The dialog's result shape; mirrors ConversationSearchResult. */
export interface SessionSearchResult {
  id: string
  title: string
  meta?: string
  snippet?: string
  messageUid?: string | null
}

export interface SessionSearchHttp {
  get<T>(path: string): Promise<T>
}

export function sessionSearchPath(query: string, limit = 20, includeArchived = true): string {
  return `/ai-session/sessions/search?q=${encodeURIComponent(query)}&limit=${limit}&includeArchived=${includeArchived}`
}

export function toSessionSearchResults(items: readonly SessionSearchItem[] | null | undefined): SessionSearchResult[] {
  return (items ?? []).filter(item => item?.session?.id).map(item => ({
    id: item.session.id,
    title: item.session.title || item.session.projectName || "Untitled session",
    meta: item.archived ? "archived" : undefined,
    snippet: item.snippet || undefined,
    messageUid: item.messageUid ?? null,
  }))
}

/** Searches the caller's sessions, archived ones included, newest first. */
export function sessionSearchSource(http: SessionSearchHttp, limit = 20) {
  return {
    async search(query: string): Promise<SessionSearchResult[]> {
      const data = await http.get<{ items?: SessionSearchItem[] }>(sessionSearchPath(query, limit))
      return toSessionSearchResults(data?.items)
    },
  }
}
