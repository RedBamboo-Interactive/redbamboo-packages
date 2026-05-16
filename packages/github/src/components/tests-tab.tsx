import { useState, useEffect, useCallback, useRef } from "react"
import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  Badge,
} from "@redbamboo/ui"
import type { TestSuiteDefinition, TestHistoryRun } from "../types"
import type { TestClient } from "../api/test-client"
import { TestSparkline } from "./test-sparkline"
import { timeAgo } from "./shared"

interface Props {
  suites: TestSuiteDefinition[]
  loading: boolean
  testClient: TestClient | null
  onRefresh: () => void
}

export function TestsTab({ suites, loading, testClient, onRefresh }: Props) {
  const [suiteFilter, setSuiteFilter] = useState("")
  const [runningSuites, setRunningSuites] = useState<Set<string>>(new Set())
  const [history, setHistory] = useState<Record<string, { name: string; runs: TestHistoryRun[] }[]>>({})
  const activeStreams = useRef(new Map<string, { close: () => void }>())

  const loadHistory = useCallback(async (suiteKey: string) => {
    if (!testClient) return
    try {
      const result = await testClient.getSuiteHistory(suiteKey, { limit: 20 })
      setHistory(prev => ({ ...prev, [suiteKey]: result.tests }))
    } catch { }
  }, [testClient])

  useEffect(() => {
    for (const suite of suites) {
      loadHistory(suite.key)
    }
  }, [suites, loadHistory])

  useEffect(() => {
    const streams = activeStreams.current
    return () => {
      for (const stream of streams.values()) stream.close()
      streams.clear()
    }
  }, [])

  const handleRunSuite = useCallback(async (suiteKey: string) => {
    if (!testClient) return
    setRunningSuites(prev => new Set([...prev, suiteKey]))
    try {
      const result = await testClient.runTestSuite(suiteKey)
      if (result.ok) {
        const stream = testClient.streamTestRun(result.run_id,
          (event) => {
            if (event.type === "result") {
              activeStreams.current.delete(suiteKey)
              setRunningSuites(prev => {
                const next = new Set(prev)
                next.delete(suiteKey)
                return next
              })
              onRefresh()
              loadHistory(suiteKey)
            }
          },
          () => {
            activeStreams.current.delete(suiteKey)
            setRunningSuites(prev => {
              const next = new Set(prev)
              next.delete(suiteKey)
              return next
            })
          },
        )
        activeStreams.current.set(suiteKey, stream)
      }
    } catch {
      setRunningSuites(prev => {
        const next = new Set(prev)
        next.delete(suiteKey)
        return next
      })
    }
  }, [testClient, onRefresh, loadHistory])

  const handleRunAll = useCallback(async () => {
    if (!testClient) return
    for (const suite of suites) {
      await handleRunSuite(suite.key)
    }
  }, [testClient, suites, handleRunSuite])

  const filteredSuites = suites.filter(s => {
    if (suiteFilter && s.key !== suiteFilter) return false
    return true
  })

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-overlay-6 flex-none">
        <Tabs value={suiteFilter} onValueChange={setSuiteFilter}>
          <TabsList className="h-7">
            <TabsTrigger value="" className="text-xs px-2">All</TabsTrigger>
            {suites.map(s => (
              <TabsTrigger key={s.key} value={s.key} className="text-xs px-2">
                {s.display_name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs ml-auto"
          onClick={handleRunAll}
          disabled={runningSuites.size > 0}
        >
          <i className="fa-solid fa-play text-[10px] mr-1" />
          Run All
        </Button>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <i className="fa-solid fa-spinner fa-spin text-text-muted" />
          </div>
        ) : filteredSuites.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-text-muted">
            No test suites discovered
          </div>
        ) : (
          <div className="divide-y divide-overlay-6">
            {filteredSuites.map(suite => {
              const isRunning = runningSuites.has(suite.key)
              const latest = suite.latest_run
              const suiteHistory = history[suite.key] ?? []

              return (
                <div key={suite.key} className="px-4 py-3">
                  <div className="flex items-center gap-2 mb-2">
                    {isRunning ? (
                      <i className="fa-solid fa-spinner fa-spin text-sm text-text-muted" />
                    ) : latest?.passed === true ? (
                      <i className="fa-solid fa-circle-check text-sm text-emerald-400" />
                    ) : latest?.passed === false ? (
                      <i className="fa-solid fa-circle-xmark text-sm text-red-400" />
                    ) : (
                      <i className="fa-solid fa-minus text-sm text-text-muted" />
                    )}

                    <span className="text-sm font-medium">{suite.display_name}</span>

                    <Badge variant="outline" className="text-[9px]">
                      {suite.framework}
                    </Badge>

                    {latest && (
                      <span className="text-xs text-text-muted ml-auto">
                        {latest.passed_count ?? 0}/{latest.total_tests ?? 0} passed
                        {(latest.failed_count ?? 0) > 0 && (
                          <span className="text-red-400 ml-1">{latest.failed_count} failed</span>
                        )}
                        <span className="ml-2">{timeAgo(latest.started_at)}</span>
                      </span>
                    )}

                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 px-1.5"
                      onClick={() => handleRunSuite(suite.key)}
                      disabled={isRunning}
                      title="Run Suite"
                    >
                      <i className="fa-solid fa-play text-[10px]" />
                    </Button>
                  </div>

                  {suiteHistory.length > 0 && (
                    <div className="space-y-1 ml-6">
                      {suiteHistory.slice(0, 20).map(test => (
                        <div key={test.name} className="flex items-center gap-2">
                          <span className="text-xs text-text-muted truncate w-60" title={test.name}>
                            {test.name}
                          </span>
                          <TestSparkline runs={test.runs} />
                        </div>
                      ))}
                      {suiteHistory.length > 20 && (
                        <p className="text-[10px] text-text-muted">
                          +{suiteHistory.length - 20} more tests
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
