import { Badge } from "@redbamboo/ui"
import type { GitHubPr, Review, HealthCheckResult, TackleRun } from "../types"
import { useGitHub } from "../contexts/github-context"
import { verdictIcon, tackleStatusIcon, timeAgo } from "./shared"

interface Props {
  pr: GitHubPr
  review?: Review
  healthCheck?: HealthCheckResult
  tackle?: TackleRun
  onReview?: (pr: GitHubPr) => void
  onHealthCheck?: (pr: GitHubPr) => void
  onApprove?: (tackle: TackleRun) => void
  onMerge?: (tackle: TackleRun) => void
  onDismiss?: (tackle: TackleRun) => void
  onRetackle?: (tackle: TackleRun) => void
  onAdopt?: (pr: GitHubPr) => void
  onClick?: (pr: GitHubPr) => void
}

export function PrRow({
  pr,
  review,
  healthCheck,
  tackle,
  onReview,
  onHealthCheck,
  onApprove,
  onMerge,
  onDismiss,
  onRetackle,
  onAdopt,
  onClick,
}: Props) {
  const actions = useGitHub()
  const canApprove =
    tackle &&
    tackle.status === "awaiting_review" &&
    tackle.ai_approved &&
    !tackle.human_approved
  const canMerge = tackle && tackle.status === "awaiting_merge"
  const isBusy =
    tackle &&
    (tackle.status === "pending" ||
      tackle.status === "running" ||
      tackle.status === "merging")

  return (
    <tr
      className="border-b border-overlay-6 bg-accent-yellow-a5 hover:bg-accent-yellow-a10 transition-colors cursor-pointer"
      onClick={() => onClick?.(pr)}
    >
      <td className="px-3 py-2 w-28">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <i className="fa-solid fa-code-pull-request text-sm text-emerald-400" />
          #{pr.number}
        </span>
      </td>

      <td className="px-3 py-2 w-20 text-xs font-mono text-text-muted truncate">
        {pr.head_branch}
      </td>

      <td className="px-3 py-2 text-sm truncate max-w-[400px]">
        {pr.title}
        {pr.issue_number != null && (
          <Badge variant="outline" className="ml-2 text-[10px]">
            #{pr.issue_number}
          </Badge>
        )}
        {tackle?.model && (
          <Badge variant="outline" className="ml-1 text-[10px] text-accent-gold">
            {tackle.model}
          </Badge>
        )}
      </td>

      <td className="px-3 py-2 text-xs text-text-muted w-28 truncate">
        {pr.author}
      </td>

      <td className="px-3 py-2 text-xs text-text-muted w-20">
        {timeAgo(pr.created_at)}
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
          <i className="fa-solid fa-spinner fa-spin text-sm text-text-muted" />
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
          <i className="fa-solid fa-spinner fa-spin text-sm text-text-muted" />
        ) : healthCheck?.verdict === "healthy" ? (
          <i className="fa-solid fa-flask text-sm text-emerald-400" />
        ) : healthCheck?.verdict === "degraded" ? (
          <i className="fa-solid fa-flask text-sm text-accent-gold" />
        ) : null}
      </td>

      <td className="px-3 py-2 w-40">
        <div
          className="flex items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          {tackle && tackleStatusIcon(tackle.status)}

          {isBusy && (
            <span className="text-[10px] text-text-muted capitalize ml-1">
              {tackle.status}
            </span>
          )}

          {!tackle && onAdopt && (
            <button
              onClick={() => onAdopt(pr)}
              className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md bg-overlay-6 text-text-muted hover:bg-overlay-10 hover:text-contrast transition-colors"
            >
              Adopt
            </button>
          )}

          {onReview && (
            <button onClick={() => onReview(pr)} title="Auto Review" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-robot text-[11px] text-text-muted opacity-60" />
            </button>
          )}

          {onHealthCheck && (
            <button onClick={() => onHealthCheck(pr)} title="Health Check" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-flask text-[11px] text-text-muted opacity-60" />
            </button>
          )}

          {canApprove && onApprove && (
            <button onClick={() => onApprove(tackle)} title="Approve" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-check text-[11px] text-emerald-400" />
            </button>
          )}

          {canMerge && onMerge && (
            <button onClick={() => onMerge(tackle)} title="Merge" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-code-merge text-[11px] text-emerald-400" />
            </button>
          )}

          {tackle && !isBusy && tackle.status !== "merged" && onDismiss && (
            <button onClick={() => onDismiss(tackle)} title="Dismiss" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-xmark text-[11px] text-text-muted opacity-60" />
            </button>
          )}

          {tackle?.status === "dismissed" && onRetackle && (
            <button onClick={() => onRetackle(tackle)} title="Re-tackle" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-rotate-left text-[11px] text-text-muted opacity-60" />
            </button>
          )}
        </div>
      </td>
    </tr>
  )
}
