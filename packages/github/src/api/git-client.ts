import type {
  Fetcher,
  GitHubClientConfig,
  GitRepo,
  GitDiffResult,
  CommitFilters,
  PaginatedCommitsResponse,
  RepoWorkingState,
  GitHubPr,
} from "../types"
import { buildParams } from "./util"

export interface GitClient {
  getRepos(): Promise<{ ok: boolean; repositories: GitRepo[] }>
  getCommitsPaginated(filters?: CommitFilters): Promise<PaginatedCommitsResponse>
  getDiff(repoName: string, hash: string): Promise<GitDiffResult>
  fetch(): Promise<{
    ok: boolean
    repos: { name: string; ok: boolean; output: string }[]
  }>
  alignToRevision(
    repoName: string,
    commitHash: string,
  ): Promise<{ ok: boolean; message: string; was_dirty: boolean }>
  launchReview(
    repoName: string,
    commitHash: string,
  ): Promise<{ ok: boolean; message: string }>
  getWorkingState(): Promise<{ ok: boolean; repos: RepoWorkingState[] }>
  getPullRequests(branch?: string): Promise<{
    ok: boolean
    pull_requests: GitHubPr[]
  }>
}

export function createGitClient(fetcher: Fetcher, config: GitHubClientConfig): GitClient {
  const base = (extra?: Record<string, string | undefined>) =>
    buildParams(config, extra)

  return {
    getRepos: () =>
      fetcher.get(`/api/git/repos?${base()}`),

    getCommitsPaginated: (filters) => {
      const p: Record<string, string | undefined> = {}
      if (filters?.page) p.page = String(filters.page)
      if (filters?.per_page) p.per_page = String(filters.per_page)
      if (filters?.author) p.author = filters.author
      if (filters?.search) p.search = filters.search
      if (filters?.since) p.since = filters.since
      if (filters?.branch) p.branch = filters.branch
      return fetcher.get(`/api/git/commits?${base(p)}`)
    },

    getDiff: (repoName, hash) =>
      fetcher.get(`/api/git/diff/${repoName}/${hash}?${base()}`),

    fetch: () =>
      fetcher.post(`/api/git/fetch?${base()}`),

    alignToRevision: (repoName, commitHash) =>
      fetcher.post(`/api/git/align?${base()}`, {
        repo_name: repoName,
        commit_hash: commitHash,
      }),

    launchReview: (repoName, commitHash) =>
      fetcher.post(`/api/git/review?${base()}`, {
        repo_name: repoName,
        commit_hash: commitHash,
      }),

    getWorkingState: () =>
      fetcher.get(`/api/git/working-state?${base()}`),

    getPullRequests: (branch) =>
      fetcher.get(`/api/git/pulls?${base(branch ? { branch } : undefined)}`),
  }
}
