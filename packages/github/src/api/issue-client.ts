import type {
  Fetcher,
  GitHubClientConfig,
  IssueFilters,
  IssueCreateRequest,
  PaginatedIssuesResponse,
} from "../types"
import { buildParams } from "./util"

export interface IssueCreateStream {
  onStatus: (cb: (status: string) => void) => IssueCreateStream
  onDone: (cb: (result: { issue_url: string; refined_title: string }) => void) => IssueCreateStream
  onError: (cb: (error: string) => void) => IssueCreateStream
  close: () => void
}

export interface IssueClient {
  getIssuesPaginated(filters?: IssueFilters): Promise<PaginatedIssuesResponse>
  createIssue(req: IssueCreateRequest): IssueCreateStream
  closeIssue(
    number: number,
    reason?: "completed" | "not_planned",
  ): Promise<{ ok: boolean; message: string }>
  reopenIssue(number: number): Promise<{ ok: boolean; message: string }>
}

export function createIssueClient(fetcher: Fetcher, config: GitHubClientConfig): IssueClient {
  const base = (extra?: Record<string, string | undefined>) =>
    buildParams(config, extra)

  return {
    getIssuesPaginated: (filters) => {
      const p: Record<string, string | undefined> = {}
      if (filters?.state) p.state = filters.state
      if (filters?.labels) p.labels = filters.labels
      if (filters?.page) p.page = String(filters.page)
      if (filters?.per_page) p.per_page = String(filters.per_page)
      return fetcher.get(`/api/issues?${base(p)}`)
    },

    createIssue: (req) => {
      let statusCb: ((s: string) => void) | null = null
      let doneCb: ((r: { issue_url: string; refined_title: string }) => void) | null = null
      let errorCb: ((e: string) => void) | null = null
      let abortController: AbortController | null = new AbortController()

      const stream: IssueCreateStream = {
        onStatus: (cb) => { statusCb = cb; return stream },
        onDone: (cb) => { doneCb = cb; return stream },
        onError: (cb) => { errorCb = cb; return stream },
        close: () => { abortController?.abort(); abortController = null },
      }

      const run = async () => {
        try {
          const url = `/api/issues/create?${base()}`

          if (!fetcher.postStream) {
            errorCb?.("Fetcher does not support streaming (postStream required)")
            return
          }
          const response = await fetcher.postStream(url, req)

          if (!response.ok || !response.body) {
            errorCb?.(`HTTP ${response.status}`)
            return
          }

          const reader = response.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { done, value } = await reader.read()
            if (done) break

            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split("\n")
            buffer = lines.pop() ?? ""

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue
              try {
                const event = JSON.parse(line.slice(6))
                if (event.type === "status") statusCb?.(event.content)
                else if (event.type === "done") {
                  try { doneCb?.(JSON.parse(event.content)) }
                  catch { doneCb?.({ issue_url: event.content, refined_title: "" }) }
                }
                else if (event.type === "error") errorCb?.(event.content)
              } catch { /* skip malformed lines */ }
            }
          }
        } catch (err) {
          if ((err as Error).name !== "AbortError")
            errorCb?.(String(err))
        }
      }

      // defer to next microtask so callbacks are registered first
      Promise.resolve().then(run)
      return stream
    },

    closeIssue: (number, reason = "completed") =>
      fetcher.post(`/api/issues/close?${base()}`, { number, reason }),

    reopenIssue: (number) =>
      fetcher.post(`/api/issues/reopen?${base()}`, { number }),
  }
}
