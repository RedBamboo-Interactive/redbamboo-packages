import {
  CheckCircle,
  XCircle,
  Loader2,
  FlaskConical,
} from "lucide-react"
import { Badge, Button } from "@redbamboo/ui"
import type { HealthCheckResult, HealthCheckSuiteResult } from "../types"
import { timeAgo } from "../components/shared"

interface Props {
  open: boolean
  healthCheck: HealthCheckResult | null
  onClose: () => void
}

export function HealthCheckDetailModal({ open, healthCheck, onClose }: Props) {
  if (!open || !healthCheck) return null

  const isPending = healthCheck.status === "pending" || healthCheck.status === "running"
  const suiteResults = healthCheck.suite_results ?? {}

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-none">
          <div className="flex items-center gap-2">
            <FlaskConical className="size-4" />
            <h2 className="text-sm font-medium">Health Check</h2>
            {healthCheck.verdict && (
              <Badge
                variant="outline"
                className={`text-[10px] ${
                  healthCheck.verdict === "healthy"
                    ? "text-emerald-400 border-emerald-400"
                    : "text-amber-400 border-amber-400"
                }`}
              >
                {healthCheck.verdict}
              </Badge>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-contrast text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
          <div className="text-xs text-text-muted">
            {healthCheck.repo_name} &middot; {healthCheck.commit_hash.slice(0, 7)} &middot;{" "}
            {timeAgo(healthCheck.started_at)}
          </div>

          {/* Summary */}
          {!isPending && (
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <CheckCircle className="size-4 text-emerald-400" />
                {healthCheck.passed_suites} passed
              </span>
              <span className="flex items-center gap-1">
                <XCircle className="size-4 text-red-400" />
                {healthCheck.failed_suites} failed
              </span>
              <span className="text-text-muted">
                of {healthCheck.total_suites} suites
              </span>
            </div>
          )}

          {/* Error */}
          {healthCheck.status === "failed" && healthCheck.error_message && (
            <div className="bg-red-500/10 text-red-400 rounded-md p-3 text-sm">
              {healthCheck.error_message}
            </div>
          )}

          {/* Suite results */}
          {Object.keys(suiteResults).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
                Suite Results
              </h3>
              {Object.entries(suiteResults).map(([key, r]) => {
                const suite = r as HealthCheckSuiteResult
                return (
                  <div
                    key={key}
                    className={`rounded-md p-3 text-sm ${
                      suite.passed ? "bg-emerald-500/5" : "bg-red-500/5"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {suite.passed ? (
                        <CheckCircle className="size-4 text-emerald-400" />
                      ) : (
                        <XCircle className="size-4 text-red-400" />
                      )}
                      <span className="font-medium">
                        {suite.display_name ?? key}
                      </span>
                      <Badge variant="outline" className="text-[9px]">
                        {suite.framework ?? ""}
                      </Badge>
                      <span className="text-xs text-text-muted ml-auto">
                        {suite.passed_count}/{suite.total} passed
                        {suite.duration_seconds > 0 && (
                          <span className="ml-1">
                            ({suite.duration_seconds.toFixed(1)}s)
                          </span>
                        )}
                      </span>
                    </div>
                    {suite.error && (
                      <p className="text-xs text-red-400 mt-1 ml-6">
                        {suite.error}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {/* Pending spinner */}
          {isPending && (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted">
              <Loader2 className="size-8 animate-spin mb-3" />
              <p className="text-sm">
                {healthCheck.status === "pending"
                  ? "Queued..."
                  : "Running test suites..."}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end px-4 py-3 border-t border-border flex-none">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
