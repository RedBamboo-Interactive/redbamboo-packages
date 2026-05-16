import {
  GitPullRequest,
  Bot,
  FlaskConical,
  Check,
  GitMerge,
  X,
  RotateCcw,
  Loader2,
} from "lucide-react"
import { Badge, Button } from "@redbamboo/ui"
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
      className="border-b border-border bg-accent-yellow-a5 hover:bg-accent-yellow-a10 transition-colors cursor-pointer"
      onClick={() => onClick?.(pr)}
    >
      {/* PR icon + number */}
      <td className="px-3 py-2 w-28">
        <span className="flex items-center gap-1.5 text-xs font-medium">
          <GitPullRequest className="size-4 text-emerald-400" />
          #{pr.number}
        </span>
      </td>

      {/* Branch */}
      <td className="px-3 py-2 w-20 text-xs font-mono text-text-muted truncate">
        {pr.head_branch}
      </td>

      {/* Title + issue link */}
      <td className="px-3 py-2 text-sm truncate max-w-[400px]">
        {pr.title}
        {pr.issue_number != null && (
          <Badge variant="outline" className="ml-2 text-[10px]">
            #{pr.issue_number}
          </Badge>
        )}
        {tackle?.model && (
          <Badge variant="outline" className="ml-1 text-[10px] text-amber-400">
            {tackle.model}
          </Badge>
        )}
      </td>

      {/* Author */}
      <td className="px-3 py-2 text-xs text-text-muted w-28 truncate">
        {pr.author}
      </td>

      {/* Date */}
      <td className="px-3 py-2 text-xs text-text-muted w-20">
        {timeAgo(pr.created_at)}
      </td>

      {/* Review status */}
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
          <Loader2 className="size-4 text-muted-foreground animate-spin" />
        ) : review?.verdict ? (
          verdictIcon(review.verdict)
        ) : null}
      </td>

      {/* Health check status */}
      <td className="px-3 py-2 w-8">
        {healthCheck?.status === "pending" ||
        healthCheck?.status === "running" ? (
          <Loader2 className="size-4 text-muted-foreground animate-spin" />
        ) : healthCheck?.verdict === "healthy" ? (
          <FlaskConical className="size-4 text-emerald-400" />
        ) : healthCheck?.verdict === "degraded" ? (
          <FlaskConical className="size-4 text-amber-400" />
        ) : null}
      </td>

      {/* Tackle status + actions */}
      <td className="px-3 py-2 w-40">
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {tackle && tackleStatusIcon(tackle.status)}

          {isBusy && (
            <span className="text-[10px] text-text-muted capitalize">
              {tackle.status}
            </span>
          )}

          {!tackle && onAdopt && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              onClick={() => onAdopt(pr)}
            >
              Adopt
            </Button>
          )}

          {onReview && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              onClick={() => onReview(pr)}
              title="Auto Review"
            >
              <Bot className="size-3.5" />
            </Button>
          )}

          {onHealthCheck && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              onClick={() => onHealthCheck(pr)}
              title="Health Check"
            >
              <FlaskConical className="size-3.5" />
            </Button>
          )}

          {canApprove && onApprove && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-emerald-400"
              onClick={() => onApprove(tackle)}
              title="Approve"
            >
              <Check className="size-3.5" />
            </Button>
          )}

          {canMerge && onMerge && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-emerald-400"
              onClick={() => onMerge(tackle)}
              title="Merge"
            >
              <GitMerge className="size-3.5" />
            </Button>
          )}

          {tackle &&
            !isBusy &&
            tackle.status !== "merged" &&
            onDismiss && (
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-1.5 text-text-muted"
                onClick={() => onDismiss(tackle)}
                title="Dismiss"
              >
                <X className="size-3.5" />
              </Button>
            )}

          {tackle?.status === "dismissed" && onRetackle && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              onClick={() => onRetackle(tackle)}
              title="Re-tackle"
            >
              <RotateCcw className="size-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}
