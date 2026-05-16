import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Info,
  Loader2,
  FileCode,
  FlaskConical,
  Shield,
} from "lucide-react"
import { Badge, Button } from "@redbamboo/ui"
import type { Review, ReviewFinding } from "../types"
import { verdictIcon } from "../components/shared"

interface Props {
  open: boolean
  review: Review | null
  onClose: () => void
}

const SEVERITY_CONFIG = {
  error: { icon: XCircle, color: "text-red-400", bg: "bg-red-500/10" },
  warn: { icon: AlertTriangle, color: "text-yellow-400", bg: "bg-yellow-500/10" },
  info: { icon: Info, color: "text-blue-400", bg: "bg-blue-500/10" },
} as const

const CATEGORY_ICONS: Record<string, typeof Shield> = {
  security: Shield,
  quality: FileCode,
  testing: FlaskConical,
}

export function ReviewDetailModal({ open, review, onClose }: Props) {
  if (!open || !review) return null

  const isPending = review.status === "pending" || review.status === "running"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-2xl mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-none">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">Code Review</h2>
            <Badge variant="outline" className="text-[10px] font-mono">
              {review.short_hash}
            </Badge>
            {review.verdict && (
              <span className="flex items-center gap-1">
                {verdictIcon(review.verdict)}
                <span className="text-xs capitalize">{review.verdict.replace(/_/g, " ")}</span>
              </span>
            )}
            {isPending && (
              <span className="flex items-center gap-1 text-xs text-text-muted">
                <Loader2 className="size-3.5 animate-spin" />
                {review.status === "pending" ? "Queued..." : "Reviewing..."}
              </span>
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
          {/* Commit info */}
          <div className="text-sm">
            <p className="text-text-muted text-xs mb-1">
              {review.repo_name} &middot; {review.commit_hash.slice(0, 7)} &middot;{" "}
              {review.started_at && new Date(review.started_at).toLocaleString()}
            </p>
            <p className="font-medium">{review.commit_message}</p>
            {review.commit_intent && (
              <p className="text-text-muted text-xs mt-1">{review.commit_intent}</p>
            )}
          </div>

          {/* Summary */}
          {review.summary && (
            <div className="bg-overlay-5 rounded-md p-3 text-sm">
              {review.summary}
            </div>
          )}

          {/* Error */}
          {review.status === "failed" && review.error_message && (
            <div className="bg-red-500/10 text-red-400 rounded-md p-3 text-sm">
              {review.error_message}
            </div>
          )}

          {/* Findings */}
          {review.findings && review.findings.length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
                Findings ({review.findings.length})
              </h3>
              {review.findings.map((f: ReviewFinding, i: number) => {
                const sev = SEVERITY_CONFIG[f.severity] ?? SEVERITY_CONFIG.info
                const Icon = sev.icon
                const CatIcon = CATEGORY_ICONS[f.category]
                return (
                  <div key={i} className={`${sev.bg} rounded-md p-3 text-sm`}>
                    <div className="flex items-start gap-2">
                      <Icon className={`size-4 mt-0.5 flex-none ${sev.color}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          {CatIcon && <CatIcon className="size-3 text-text-muted" />}
                          <Badge variant="outline" className="text-[9px]">
                            {f.category}
                          </Badge>
                          {f.file && (
                            <span className="text-xs font-mono text-text-muted truncate">
                              {f.file}
                            </span>
                          )}
                        </div>
                        <p>{f.description}</p>
                        {f.mitigated_by && (
                          <p className="text-xs text-text-muted mt-1">
                            Mitigated by: {f.mitigated_by}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {/* Test Results */}
          {review.test_results && Object.keys(review.test_results).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
                Test Results
              </h3>
              {Object.entries(review.test_results).map(([suite, result]) => (
                <div
                  key={suite}
                  className="flex items-center gap-2 bg-overlay-5 rounded-md px-3 py-2 text-sm"
                >
                  {result.ran ? (
                    result.passed ? (
                      <CheckCircle className="size-4 text-emerald-400" />
                    ) : (
                      <XCircle className="size-4 text-red-400" />
                    )
                  ) : (
                    <span className="size-4 rounded-full border border-border" />
                  )}
                  <span className="font-medium">{suite}</span>
                  {!result.ran && (
                    <span className="text-xs text-text-muted">not run</span>
                  )}
                  {result.output_snippet && (
                    <span className="text-xs text-text-muted truncate ml-auto max-w-[200px]">
                      {result.output_snippet}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Checks */}
          {review.checks && Object.keys(review.checks).length > 0 && (
            <div className="space-y-2">
              <h3 className="text-xs font-medium text-text-muted uppercase tracking-wide">
                Checks
              </h3>
              {Object.entries(review.checks).map(([name, check]) => (
                <div
                  key={name}
                  className="flex items-center gap-2 bg-overlay-5 rounded-md px-3 py-2 text-sm"
                >
                  {check.pass ? (
                    <CheckCircle className="size-4 text-emerald-400" />
                  ) : (
                    <XCircle className="size-4 text-red-400" />
                  )}
                  <span className="font-medium capitalize">{name}</span>
                  {check.notes && (
                    <span className="text-xs text-text-muted ml-2">
                      {check.notes}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Pending state */}
          {isPending && (
            <div className="flex flex-col items-center justify-center py-8 text-text-muted">
              <Loader2 className="size-8 animate-spin mb-3" />
              <p className="text-sm">
                {review.status === "pending"
                  ? "Review is queued..."
                  : "Claude is reviewing the code..."}
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
