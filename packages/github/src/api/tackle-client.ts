import type { Fetcher, GitHubClientConfig, TackleRun, TackleStartOptions } from "../types"
import { buildParams } from "./util"

export interface TackleClient {
  startTackle(
    number: number,
    title: string,
    options: TackleStartOptions,
  ): Promise<{ ok: boolean; tackle_id: string; status: string }>
  getTackleStatus(tackleId: string): Promise<TackleRun>
  listTackles(
    issueNumber?: number,
    status?: string,
    limit?: number,
  ): Promise<{ ok: boolean; tackles: TackleRun[] }>
  approveTackle(tackleId: string): Promise<{ ok: boolean; message: string }>
  applyTackleReview(tackleId: string): Promise<{
    ok: boolean
    message: string
  }>
  mergeTackle(tackleId: string): Promise<{
    ok: boolean
    session_id: string
    status: string
  }>
  dismissTackle(tackleId: string): Promise<{ ok: boolean; message: string }>
  undismissTackle(tackleId: string): Promise<{
    ok: boolean
    message: string
  }>
  adoptPr(req: {
    pr_number: number
    issue_number?: number
    issue_title?: string
    repo_name: string
    branch_name: string
    commit_hash?: string
  }): Promise<{ ok: boolean; tackle_id: string; status: string }>
  retackleTackle(
    tackleId: string,
    options?: { mode?: string; model?: string },
  ): Promise<{ ok: boolean; tackle_id: string; status: string }>
}

export function createTackleClient(fetcher: Fetcher, config: GitHubClientConfig): TackleClient {
  const base = () => buildParams(config)

  return {
    startTackle: (number, title, options) =>
      fetcher.post(`/api/issues/tackle/start?${base()}`, { number, title, ...options }),

    getTackleStatus: (tackleId) =>
      fetcher.get(`/api/issues/tackle/${tackleId}?${base()}`),

    listTackles: (issueNumber, status, limit) =>
      fetcher.get(`/api/issues/tackle?${buildParams(config, {
        ...(issueNumber ? { issue_number: String(issueNumber) } : {}),
        ...(status ? { status } : {}),
        ...(limit ? { limit: String(limit) } : {}),
      })}`),

    approveTackle: (tackleId) =>
      fetcher.post(`/api/issues/tackle/${tackleId}/approve?${base()}`),

    applyTackleReview: (tackleId) =>
      fetcher.post(`/api/issues/tackle/${tackleId}/apply-review?${base()}`),

    mergeTackle: (tackleId) =>
      fetcher.post(`/api/issues/tackle/${tackleId}/merge?${base()}`),

    dismissTackle: (tackleId) =>
      fetcher.post(`/api/issues/tackle/${tackleId}/dismiss?${base()}`),

    undismissTackle: (tackleId) =>
      fetcher.post(`/api/issues/tackle/${tackleId}/undismiss?${base()}`),

    adoptPr: (req) =>
      fetcher.post(`/api/issues/tackle/adopt-pr?${base()}`, req),

    retackleTackle: (tackleId, options) =>
      fetcher.post(`/api/issues/tackle/${tackleId}/retackle?${base()}`, options ?? {}),
  }
}
