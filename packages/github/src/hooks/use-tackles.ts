import { useCallback, useRef } from "react"
import { usePollingMap } from "./use-polling-map"
import type { TackleRun, TackleStartOptions } from "../types"
import type { TackleClient } from "../api/tackle-client"

const TERMINAL: Set<string> = new Set(["merged", "failed", "dismissed"])

export function useTackles(client: TackleClient | null) {
  const clientRef = useRef(client)
  clientRef.current = client

  const byIssue = usePollingMap<string, TackleRun>({
    fetchItem: async (key) => {
      if (!clientRef.current) throw new Error("no client")
      const [, id] = key.split("|")
      return clientRef.current.getTackleStatus(id!)
    },
    isTerminal: (t) => TERMINAL.has(t.status),
  })

  const getTackle = useCallback(
    (issueNumber: number): TackleRun | undefined => {
      for (const [k, v] of byIssue.items) {
        if (k.startsWith(`issue:${issueNumber}|`)) return v
      }
      return undefined
    },
    [byIssue.items],
  )

  const getTackleByPr = useCallback(
    (prNumber: number): TackleRun | undefined => {
      for (const [, v] of byIssue.items) {
        if (v.pull_request_number === prNumber) return v
      }
      return undefined
    },
    [byIssue.items],
  )

  const getTackleById = useCallback(
    (tackleId: string): TackleRun | undefined => {
      for (const [, v] of byIssue.items) {
        if (v.id === tackleId) return v
      }
      return undefined
    },
    [byIssue.items],
  )

  const startTackle = useCallback(
    async (issueNumber: number, title: string, options: TackleStartOptions) => {
      if (!clientRef.current) return { ok: false, tackle_id: "", status: "error" }
      const result = await clientRef.current.startTackle(issueNumber, title, options)
      if (result.ok) {
        const key = `issue:${issueNumber}|${result.tackle_id}`
        byIssue.setAndPoll(key, {
          id: result.tackle_id,
          issue_number: issueNumber,
          issue_title: title,
          repo_name: "",
          branch_name: null,
          commit_hash: null,
          pull_request_url: null,
          pull_request_number: null,
          status: "pending",
          mode: options.mode ?? "automated",
          model: options.model ?? null,
          review_id: null,
          human_approved: false,
          ai_approved: false,
          error_message: null,
          started_at: new Date().toISOString(),
          completed_at: null,
          linked_notification_id: null,
          awaiting_human_loop_details: null,
        })
      }
      return result
    },
    [byIssue],
  )

  const loadExisting = useCallback(
    async (issueNumber: number) => {
      if (!clientRef.current) return
      const result = await clientRef.current.listTackles(issueNumber, undefined, 1)
      if (result.ok && result.tackles.length > 0) {
        const tackle = result.tackles[0]!
        const key = `issue:${issueNumber}|${tackle.id}`
        byIssue.set(key, tackle)
        if (!TERMINAL.has(tackle.status)) byIssue.startPolling(key)
      }
    },
    [byIssue],
  )

  return {
    getTackle,
    getTackleByPr,
    getTackleById,
    startTackle,
    loadExisting,
    items: byIssue.items,
  }
}
