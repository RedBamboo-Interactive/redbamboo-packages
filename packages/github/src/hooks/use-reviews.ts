import { useCallback, useRef } from "react"
import { usePollingMap } from "./use-polling-map"
import type { Review } from "../types"
import type { ReviewClient } from "../api/review-client"

const TERMINAL: Set<string> = new Set(["completed", "failed"])

export function useReviews(client: ReviewClient | null, resetKey?: string) {
  const clientRef = useRef(client)
  clientRef.current = client

  const map = usePollingMap<string, Review>({
    fetchItem: (key) => {
      if (!clientRef.current) return Promise.reject(new Error("no client"))
      const [, , id] = key.split("|")
      return clientRef.current.getReviewStatus(id!)
    },
    isTerminal: (r) => TERMINAL.has(r.status),
    resetKey,
  })

  const makeKey = (repo: string, hash: string) => `${repo}|${hash}`

  const getReview = useCallback(
    (repo: string, hash: string) => {
      for (const [k, v] of map.items) {
        if (k.startsWith(`${repo}|${hash}`)) return v
      }
      return undefined
    },
    [map.items],
  )

  const startReview = useCallback(
    async (repo: string, hash: string, tackleId?: string) => {
      if (!clientRef.current) return { ok: false, review_id: "", status: "error" }
      const result = await clientRef.current.startAutoReview(repo, hash, tackleId)
      if (result.ok) {
        const key = `${makeKey(repo, hash)}|${result.review_id}`
        map.setAndPoll(key, {
          id: result.review_id,
          repo_name: repo,
          commit_hash: hash,
          short_hash: hash.slice(0, 7),
          commit_message: "",
          verdict: null,
          status: "pending",
          summary: null,
          commit_intent: null,
          findings: null,
          test_results: null,
          checks: null,
          created_issue_urls: null,
          session_id: null,
          sandbox_id: null,
          tackle_id: tackleId ?? null,
          terminated_by_restart: false,
          error_message: null,
          started_at: new Date().toISOString(),
          completed_at: null,
        })
      }
      return result
    },
    [map],
  )

  const loadExisting = useCallback(
    async (repo: string, hash: string) => {
      if (!clientRef.current) return
      const review = await clientRef.current.getReviewForCommit(repo, hash)
      if (review) {
        const key = `${makeKey(repo, hash)}|${review.id}`
        map.set(key, review)
        if (!TERMINAL.has(review.status)) map.startPolling(key)
      }
    },
    [map],
  )

  return { getReview, startReview, loadExisting, items: map.items }
}
