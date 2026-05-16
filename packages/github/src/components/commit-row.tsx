import { Bot, FlaskConical, Play } from "lucide-react"
import { Badge, Button } from "@redbamboo/ui"
import type { GitCommit, Review, HealthCheckResult } from "../types"
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
  return (
    <tr
      className="border-b border-border hover:bg-overlay-5 transition-colors cursor-pointer"
      onClick={() => onClick?.(commit)}
    >
      {/* Area badge */}
      <td className="px-3 py-2 w-28">
        {commit.repo_name && (
          <Badge variant="outline" className="text-[10px]">
            {commit.repo_name}
          </Badge>
        )}
      </td>

      {/* Hash */}
      <td className="px-3 py-2 w-20 font-mono text-xs text-text-muted">
        {commit.short_hash}
        {unpushed && (
          <span className="ml-1 text-blue-400" title="Not pushed">
            ↑
          </span>
        )}
      </td>

      {/* Message */}
      <td className="px-3 py-2 text-sm truncate max-w-[400px]">
        {commit.message}
      </td>

      {/* Author */}
      <td className="px-3 py-2 text-xs text-text-muted w-28 truncate">
        {commit.author}
      </td>

      {/* Date */}
      <td className="px-3 py-2 text-xs text-text-muted w-20">
        {timeAgo(commit.date)}
      </td>

      {/* Review status */}
      <td className="px-3 py-2 w-8">
        {review?.status === "pending" || review?.status === "running" ? (
          <Bot className="size-4 text-muted-foreground animate-pulse" />
        ) : review?.verdict ? (
          verdictIcon(review.verdict)
        ) : null}
      </td>

      {/* Health check status */}
      <td className="px-3 py-2 w-8">
        {healthCheck?.status === "pending" ||
        healthCheck?.status === "running" ? (
          <FlaskConical className="size-4 text-muted-foreground animate-pulse" />
        ) : healthCheck?.verdict === "healthy" ? (
          <FlaskConical className="size-4 text-emerald-400" />
        ) : healthCheck?.verdict === "degraded" ? (
          <FlaskConical className="size-4 text-amber-400" />
        ) : null}
      </td>

      {/* Actions */}
      <td className="px-3 py-2 w-24">
        <div
          className="flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {onReview && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              onClick={() => onReview(commit)}
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
              onClick={() => onHealthCheck(commit)}
              title="Health Check"
            >
              <FlaskConical className="size-3.5" />
            </Button>
          )}
          {onAlign && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              onClick={() => onAlign(commit)}
              title="Align to revision"
            >
              <Play className="size-3.5" />
            </Button>
          )}
        </div>
      </td>
    </tr>
  )
}
