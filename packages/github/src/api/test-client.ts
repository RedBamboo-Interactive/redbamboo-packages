import type { Fetcher, GitHubClientConfig, TestSuiteDefinition, TestRun, TestHistoryRun } from "../types"
import { buildParams } from "./util"

export interface TestClient {
  getTestSuites(): Promise<{ suites: TestSuiteDefinition[] }>
  runTestSuite(suite: string): Promise<{
    ok: boolean
    run_id: string
    status: string
  }>
  runSingleTest(
    suite: string,
    testName: string,
  ): Promise<{ ok: boolean; run_id: string; status: string }>
  runAllTests(category?: string): Promise<{
    ok: boolean
    run_ids: string[]
    count: number
  }>
  getTestRun(id: string): Promise<{ run: TestRun; stream_subscribers: number }>
  listTestRuns(
    suite?: string,
    category?: string,
    limit?: number,
  ): Promise<{ runs: TestRun[] }>
  getLatestTestRuns(): Promise<{ suites: TestSuiteDefinition[] }>
  fixTestFailure(runId: string): Promise<{
    ok: boolean
    session_id: string
  }>
  getSuiteHistory(
    suite: string,
    query?: {
      limit?: number
      branch?: string
      commit_sha?: string
      status?: string
      test_name?: string
    },
  ): Promise<{
    suite: string
    limit: number
    tests: { name: string; runs: TestHistoryRun[] }[]
  }>
  streamTestRun(
    id: string,
    onEvent: (event: { type: string; data: unknown }) => void,
    onError?: (err: Event) => void,
  ): { eventSource: EventSource; close: () => void }
}

export function createTestClient(fetcher: Fetcher, config: GitHubClientConfig): TestClient {
  const base = (extra?: Record<string, string | undefined>) =>
    buildParams(config, extra)

  return {
    getTestSuites: () => fetcher.get(`/api/tests/suites?${base()}`),

    runTestSuite: (suite) =>
      fetcher.post(`/api/tests/run?${base()}`, { suite }),

    runSingleTest: (suite, testName) =>
      fetcher.post(`/api/tests/run-single?${base()}`, { suite, test_name: testName }),

    runAllTests: (category) =>
      fetcher.post(`/api/tests/run-all?${base()}`, { category }),

    getTestRun: (id) => fetcher.get(`/api/tests/${id}?${base()}`),

    listTestRuns: (suite, category, limit) =>
      fetcher.get(`/api/tests?${base({
        ...(suite ? { suite } : {}),
        ...(category ? { category } : {}),
        ...(limit ? { limit: String(limit) } : {}),
      })}`),

    getLatestTestRuns: () => fetcher.get(`/api/tests/latest?${base()}`),

    fixTestFailure: (runId) =>
      fetcher.post(`/api/tests/${runId}/fix?${base()}`),

    getSuiteHistory: (suite, query) =>
      fetcher.get(`/api/tests/suites/${suite}/history?${base({
        ...(query?.limit ? { limit: String(query.limit) } : {}),
        ...(query?.branch ? { branch: query.branch } : {}),
        ...(query?.commit_sha ? { commit_sha: query.commit_sha } : {}),
        ...(query?.status ? { status: query.status } : {}),
        ...(query?.test_name ? { test_name: query.test_name } : {}),
      })}`),

    streamTestRun: (id, onEvent, onError) => {
      const es = new EventSource(`/api/tests/${id}/stream?${base()}`)
      es.onmessage = (e) => {
        try {
          onEvent(JSON.parse(e.data))
        } catch {
          // ignore
        }
      }
      if (onError) es.onerror = onError
      return { eventSource: es, close: () => es.close() }
    },
  }
}
