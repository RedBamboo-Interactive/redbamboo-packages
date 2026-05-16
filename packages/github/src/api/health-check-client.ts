import type { Fetcher, GitHubClientConfig, HealthCheckResult } from "../types"
import { buildParams } from "./util"

export interface HealthCheckClient {
  startHealthCheck(
    commitHash: string,
    repoName?: string,
    tackleId?: string,
  ): Promise<{ ok: boolean; health_check_id: string; status: string }>
  getHealthCheck(id: string): Promise<HealthCheckResult>
  getHealthCheckForCommit(
    repoName: string,
    hash: string,
  ): Promise<HealthCheckResult | null>
  listHealthChecks(
    repo?: string,
    verdict?: string,
    limit?: number,
  ): Promise<{ ok: boolean; health_checks: HealthCheckResult[] }>
  retryHealthCheck(id: string): Promise<{
    ok: boolean
    health_check_id: string
    status: string
  }>
}

export function createHealthCheckClient(
  fetcher: Fetcher,
  config: GitHubClientConfig,
): HealthCheckClient {
  const base = (extra?: Record<string, string | undefined>) =>
    buildParams(config, extra)

  return {
    startHealthCheck: (commitHash, repoName, tackleId) =>
      fetcher.post(`/api/health-checks?${base()}`, {
        commit_hash: commitHash,
        repo_name: repoName,
        tackle_id: tackleId,
      }),

    getHealthCheck: (id) =>
      fetcher.get(`/api/health-checks/${id}?${base()}`),

    getHealthCheckForCommit: async (repoName, hash) => {
      try {
        return await fetcher.get<HealthCheckResult>(
          `/api/health-checks/commit/${repoName}/${hash}?${base()}`,
        )
      } catch {
        return null
      }
    },

    listHealthChecks: (repo, verdict, limit) =>
      fetcher.get(`/api/health-checks?${base({
        ...(repo ? { repo } : {}),
        ...(verdict ? { verdict } : {}),
        ...(limit ? { limit: String(limit) } : {}),
      })}`),

    retryHealthCheck: (id) =>
      fetcher.post(`/api/health-checks/${id}/retry?${base()}`),
  }
}
