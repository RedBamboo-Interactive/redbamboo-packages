import { ModalBase, ModalHeader, ModalSection, ModalFooter, CardContent, Badge, Button } from "@redbamboo/ui"
import type { GitCommit, Review, HealthCheckResult } from "../types"
import { verdictIcon, timeAgo } from "../components/shared"

interface Props {
  open: boolean
  commit: GitCommit | null
  review?: Review | null
  healthCheck?: HealthCheckResult | null
  unpushed?: boolean
  githubUrl?: string
  onClose: () => void
  onReview?: (commit: GitCommit) => void
  onHealthCheck?: (commit: GitCommit) => void
}

export function CommitDetailModal({
  open,
  commit,
  review,
  healthCheck,
  unpushed,
  githubUrl,
  onClose,
  onReview,
  onHealthCheck,
}: Props) {
  if (!open || !commit) return null

  return (
    <ModalBase
      onClose={onClose}
      dataModal="commit-detail"
      ariaLabel={`Commit detail for ${commit.short_hash}`}
      size="md"
    >
      <ModalHeader
        icon={<i className="fa-solid fa-code-commit text-base text-text-muted" />}
        title={
          <code className="text-sm font-mono bg-overlay-8 px-1.5 py-0.5 rounded">
            {commit.short_hash}
          </code>
        }
        badges={
          <>
            <Badge variant="outline" className="text-[10px]">{commit.repo_name}</Badge>
            {unpushed && (
              <Badge variant="outline" className="text-[10px] text-accent-purple border-accent-purple">
                unpushed
              </Badge>
            )}
          </>
        }
        subtitle={
          <>
            by <span className="text-contrast">{commit.author}</span>
            <span className="mx-1">&middot;</span>
            <span title={new Date(commit.date).toLocaleString()}>{timeAgo(commit.date)}</span>
          </>
        }
        onClose={onClose}
        closeLabel="Close commit detail"
      />

      <CardContent className="space-y-6">
        <ModalSection section="message" heading="Commit Message">
          <div className="text-xs text-contrast whitespace-pre-wrap bg-overlay-5 border border-overlay-10 rounded-lg px-3 py-2.5 font-mono">
            {commit.message}
          </div>
        </ModalSection>

        {review && (
          <ModalSection section="review" heading="Code Review">
            {review.verdict ? (
              <div
                className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${
                  review.verdict === "pass" ? "border-emerald-500/30 bg-emerald-500/10" :
                  review.verdict === "pass_with_notes" ? "border-yellow-500/30 bg-yellow-500/10" :
                  review.verdict === "pending_human" ? "border-blue-500/30 bg-blue-500/10" :
                  "border-red-500/30 bg-red-500/10"
                }`}
              >
                {verdictIcon(review.verdict)}
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold capitalize">{review.verdict.replace(/_/g, " ")}</span>
                  {review.completed_at && (
                    <span className="text-xs text-text-muted ml-2">{timeAgo(review.completed_at)}</span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <i className="fa-solid fa-spinner fa-spin text-[11px]" />
                <span className="capitalize">{review.status}</span>
              </div>
            )}

            {review.commit_intent && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold mb-1">What this commit does</h4>
                <p className="text-sm text-text-muted">{review.commit_intent}</p>
              </div>
            )}

            {review.summary && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold mb-1">Assessment</h4>
                <p className="text-sm text-text-muted">{review.summary}</p>
              </div>
            )}

            {review.findings && review.findings.length > 0 && (
              <div className="mt-3">
                <h4 className="text-xs font-semibold mb-2">Findings ({review.findings.length})</h4>
                <div className="space-y-1.5">
                  {review.findings.slice(0, 3).map((f, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs">
                      <Badge
                        variant="outline"
                        className={`text-[10px] px-1.5 py-0 shrink-0 mt-0.5 ${
                          f.severity === "error" ? "text-red-400 border-red-500/25" :
                          f.severity === "warning" || f.severity === "warn" ? "text-yellow-400 border-yellow-500/25" :
                          "text-blue-400 border-blue-500/25"
                        }`}
                      >
                        {f.severity}
                      </Badge>
                      <span className="text-text-muted">{f.description}</span>
                    </div>
                  ))}
                  {review.findings.length > 3 && (
                    <p className="text-[11px] text-text-muted">+{review.findings.length - 3} more</p>
                  )}
                </div>
              </div>
            )}
          </ModalSection>
        )}

        {healthCheck && (
          <ModalSection section="health-check" heading="Health Check">
            {healthCheck.status === "pending" || healthCheck.status === "running" ? (
              <div className="flex items-center gap-2 text-sm text-text-muted">
                <i className="fa-solid fa-spinner fa-spin text-[11px]" />
                <span>{healthCheck.status === "pending" ? "Queued" : "Running"}</span>
              </div>
            ) : (
              <div className={`rounded-lg border px-4 py-3 flex items-center gap-3 ${
                healthCheck.verdict === "healthy"
                  ? "border-emerald-500/30 bg-emerald-500/10"
                  : "border-yellow-500/30 bg-yellow-500/10"
              }`}>
                {healthCheck.verdict === "healthy" ? (
                  <i className="fa-solid fa-circle-check text-base text-emerald-400" />
                ) : (
                  <i className="fa-solid fa-triangle-exclamation text-base text-accent-gold" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="text-sm font-semibold capitalize">{healthCheck.verdict}</span>
                  <span className="text-xs text-text-muted ml-2">
                    {healthCheck.passed_suites}/{healthCheck.total_suites} passed
                  </span>
                </div>
              </div>
            )}
          </ModalSection>
        )}

        <ModalFooter>
          {onReview && !review && commit && (
            <button
              onClick={() => onReview(commit)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-overlay-6 text-text-muted hover:bg-overlay-10 hover:text-contrast transition-colors"
            >
              <i className="fa-solid fa-robot text-[11px]" />
              Review
            </button>
          )}
          {onHealthCheck && !healthCheck && commit && (
            <button
              onClick={() => onHealthCheck(commit)}
              className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-overlay-6 text-text-muted hover:bg-overlay-10 hover:text-contrast transition-colors"
            >
              <i className="fa-solid fa-flask text-[11px]" />
              Health Check
            </button>
          )}
          <span className="flex-1" />
          {githubUrl && (
            <a href={githubUrl} target="_blank" rel="noopener noreferrer" className="ml-auto">
              <Button variant="ghost" size="sm">
                <i className="fa-brands fa-github text-[11px] mr-1.5" />
                View on GitHub
              </Button>
            </a>
          )}
        </ModalFooter>
      </CardContent>
    </ModalBase>
  )
}
