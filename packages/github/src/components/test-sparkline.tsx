import type { TestHistoryRun } from "../types"

interface Props {
  runs: TestHistoryRun[]
  maxBars?: number
}

const STATUS_COLORS: Record<string, string> = {
  passed: "bg-emerald-400",
  failed: "bg-red-400",
  skipped: "bg-yellow-400",
}

export function TestSparkline({ runs, maxBars = 20 }: Props) {
  const padCount = Math.max(0, maxBars - runs.length)

  return (
    <div
      className="flex items-end gap-px h-4"
      role="img"
      aria-label={`${runs.length} test runs: ${runs.filter(r => r.status === "passed").length} passed, ${runs.filter(r => r.status === "failed").length} failed`}
    >
      {Array.from({ length: padCount }).map((_, i) => (
        <div key={`pad-${i}`} className="w-1 h-full bg-overlay-5 rounded-sm" />
      ))}
      {runs.map((run, i) => (
        <div
          key={run.run_id || i}
          className={`w-1 h-full rounded-sm ${STATUS_COLORS[run.status] ?? "bg-overlay-10"}`}
          title={`${run.status} on ${run.branch} at ${run.commit_sha?.slice(0, 7)}`}
          data-run-id={run.run_id}
          data-status={run.status}
          data-branch={run.branch}
          data-commit-sha={run.commit_sha}
          data-started-at={run.started_at}
        />
      ))}
    </div>
  )
}
