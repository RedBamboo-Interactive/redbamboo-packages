import type { Fetcher, GitHubClientConfig, Review } from "../types"
import { buildParams } from "./util"

export interface ReviewClient {
  startAutoReview(
    repoName: string,
    commitHash: string,
    tackleId?: string,
  ): Promise<{ ok: boolean; review_id: string; status: string }>
  getReviewStatus(reviewId: string): Promise<Review>
  getReviewForCommit(
    repoName: string,
    hash: string,
  ): Promise<Review | null>
  listReviews(
    repo?: string,
    limit?: number,
  ): Promise<{ ok: boolean; reviews: Review[] }>
  retryReview(reviewId: string): Promise<{
    ok: boolean
    review_id: string
    status: string
  }>
}

export function createReviewClient(fetcher: Fetcher, config: GitHubClientConfig): ReviewClient {
  const base = (extra?: Record<string, string | undefined>) =>
    buildParams(config, extra)

  return {
    startAutoReview: (repoName, commitHash, tackleId) =>
      fetcher.post(`/api/reviews/auto?${base()}`, {
        repo_name: repoName,
        commit_hash: commitHash,
        tackle_id: tackleId,
      }),

    getReviewStatus: (reviewId) =>
      fetcher.get(`/api/reviews/${reviewId}?${base()}`),

    getReviewForCommit: async (repoName, hash) => {
      try {
        return await fetcher.get<Review>(
          `/api/reviews/commit/${repoName}/${hash}?${base()}`,
        )
      } catch {
        return null
      }
    },

    listReviews: (repo, limit) =>
      fetcher.get(`/api/reviews?${base({
        ...(repo ? { repo } : {}),
        ...(limit ? { limit: String(limit) } : {}),
      })}`),

    retryReview: (reviewId) =>
      fetcher.post(`/api/reviews/${reviewId}/retry?${base()}`),
  }
}
