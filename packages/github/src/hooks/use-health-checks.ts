import { useCallback, useRef } from "react"
import { usePollingMap } from "./use-polling-map"
import type { HealthCheckResult } from "../types"
import type { HealthCheckClient } from "../api/health-check-client"

const TERMINAL: Set<string> = new Set(["completed", "failed"])

export function useHealthChecks(client: HealthCheckClient | null, resetKey?: string) {
  const clientRef = useRef(client)
  clientRef.current = client

  const map = usePollingMap<string, HealthCheckResult>({
    fetchItem: (key) => {
      if (!clientRef.current) return Promise.reject(new Error("no client"))
      const [, , id] = key.split("|")
      return clientRef.current.getHealthCheck(id!)
    },
    isTerminal: (hc) => TERMINAL.has(hc.status),
    resetKey,
  })

  const getHc = useCallback(
    (repo: string, hash: string) => {
      for (const [k, v] of map.items) {
        if (k.startsWith(`${repo}|${hash}`)) return v
      }
      return undefined
    },
    [map.items],
  )

  const startHealthCheck = useCallback(
    async (repo: string, hash: string, tackleId?: string) => {
      if (!clientRef.current) return { ok: false, health_check_id: "", status: "error" }
      const result = await clientRef.current.startHealthCheck(hash, repo, tackleId)
      if (result.ok) {
        const key = `${repo}|${hash}|${result.health_check_id}`
        map.setAndPoll(key, {
          id: result.health_check_id,
          repo_name: repo,
          commit_hash: hash,
          short_hash: hash.slice(0, 7),
          commit_message: "",
          status: "pending",
          verdict: null,
          total_suites: 0,
          passed_suites: 0,
          failed_suites: 0,
          suite_results: null,
          sandbox_id: null,
          duration_seconds: null,
          branch: null,
          tackle_id: tackleId ?? null,
          error_message: null,
          terminated_by_restart: false,
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
      const hc = await clientRef.current.getHealthCheckForCommit(repo, hash)
      if (hc) {
        const key = `${repo}|${hash}|${hc.id}`
        map.set(key, hc)
        if (!TERMINAL.has(hc.status)) map.startPolling(key)
      }
    },
    [map],
  )

  return { getHc, startHealthCheck, loadExisting, items: map.items }
}
