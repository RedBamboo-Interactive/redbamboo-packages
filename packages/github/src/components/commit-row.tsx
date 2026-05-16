import { Badge } from "@redbamboo/ui"
import type { GitCommit, Review, HealthCheckResult } from "../types"
import { useGitHub } from "../contexts/github-context"
import { verdictIcon, timeAgo } from "./shared"

interface Props {
  commit: GitCommit
  review?: Review
  healthCheck?: HealthCheckResult
  unpushed?: boolean
  onReview?: (commit: GitCommit) => void
  onHealthCheck?: (commit: GitCommit) => void
  onAlign?: (commit: GitCommit) => void
  onClick?: (commit: GitCommit) => void
}

export function CommitRow({
  commit,
  review,
  healthCheck,
  unpushed,
  onReview,
  onHealthCheck,
  onAlign,
  onClick,
}: Props) {
  const actions = useGitHub()
  return (
    <tr
      className="border-b border-overlay-6 hover:bg-overlay-5 transition-colors cursor-pointer"
      onClick={() => onClick?.(commit)}
    >
      <td className="px-3 py-2 w-28">
        {commit.repo_name && (
          <Badge variant="outline" className="text-[10px]">
            {commit.repo_name}
          </Badge>
        )}
      </td>

      <td className="px-3 py-2 w-20 font-mono text-xs text-text-muted">
        {commit.short_hash}
        {unpushed && (
          <span className="ml-1 text-accent-purple" title="Not pushed">
            <i className="fa-solid fa-arrow-up text-[9px]" />
          </span>
        )}
      </td>

      <td className="px-3 py-2 text-sm truncate max-w-[400px]">
        {commit.message}
      </td>

      <td className="px-3 py-2 text-xs text-text-muted w-28 truncate">
        {commit.author}
      </td>

      <td className="px-3 py-2 text-xs text-text-muted w-20">
        {timeAgo(commit.date)}
      </td>

      <td
        className="px-3 py-2 w-8"
        onClick={(e) => {
          if (!review) return
          e.stopPropagation()
          actions.onClickReview?.(review)
        }}
        style={review ? { cursor: "pointer" } : undefined}
      >
        {review?.status === "pending" || review?.status === "running" ? (
          <i className="fa-solid fa-robot text-sm text-text-muted animate-pulse" />
        ) : review?.verdict ? (
          verdictIcon(review.verdict)
        ) : null}
      </td>

      <td
        className="px-3 py-2 w-8"
        onClick={(e) => {
          if (!healthCheck) return
          e.stopPropagation()
          actions.onClickHealthCheck?.(healthCheck)
        }}
        style={healthCheck ? { cursor: "pointer" } : undefined}
      >
        {healthCheck?.status === "pending" ||
        healthCheck?.status === "running" ? (
          <i className="fa-solid fa-flask text-sm text-text-muted animate-pulse" />
        ) : healthCheck?.verdict === "healthy" ? (
          <i className="fa-solid fa-flask text-sm text-emerald-400" />
        ) : healthCheck?.verdict === "degraded" ? (
          <i className="fa-solid fa-flask text-sm text-accent-gold" />
        ) : null}
      </td>

      <td className="px-3 py-2 w-24">
        <div
          className="flex items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {onReview && (
            <button
              onClick={() => onReview(commit)}
              title="Auto Review"
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors"
            >
              <i className="fa-solid fa-robot text-[11px] text-text-muted opacity-60" />
            </button>
          )}
          {onHealthCheck && (
            <button
              onClick={() => onHealthCheck(commit)}
              title="Health Check"
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors"
            >
              <i className="fa-solid fa-flask text-[11px] text-text-muted opacity-60" />
            </button>
          )}
          {onAlign && (
            <button
              onClick={() => onAlign(commit)}
              title="Align to revision"
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors"
            >
              <i className="fa-solid fa-play text-[10px] text-text-muted opacity-60" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
