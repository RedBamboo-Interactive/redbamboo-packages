import {
  ExternalLink,
  Zap,
  X,
  RotateCw,
} from "lucide-react"
import { Badge, Button } from "@redbamboo/ui"
import type { GitHubIssue, TackleRun } from "../types"
import { issueTypeIcon, tackleStatusIcon, timeAgo } from "./shared"

interface Props {
  issue: GitHubIssue
  tackle?: TackleRun
  onAutoTackle?: (issue: GitHubIssue) => void
  onClose?: (issue: GitHubIssue) => void
  onReopen?: (issue: GitHubIssue) => void
  onClick?: (issue: GitHubIssue) => void
  onClickTackle?: (tackle: TackleRun) => void
  getIssueUrl?: (number: number) => string
}

export function IssueRow({
  issue,
  tackle,
  onAutoTackle,
  onClose,
  onReopen,
  onClick,
  onClickTackle,
  getIssueUrl,
}: Props) {
  return (
    <tr
      className="border-b border-border hover:bg-overlay-5 transition-colors cursor-pointer"
      onClick={() => onClick?.(issue)}
    >
      {/* Issue type icon + number */}
      <td className="px-3 py-2 w-20">
        <span className="flex items-center gap-1.5">
          {issueTypeIcon(issue.labels)}
          <span className="text-xs font-medium text-text-muted">
            #{issue.number}
          </span>
        </span>
      </td>

      {/* Title + body preview */}
      <td className="px-3 py-2 text-sm">
        <div className="truncate max-w-[400px] font-medium">
          {issue.title}
        </div>
        {issue.body && (
          <div className="text-xs text-text-muted truncate max-w-[400px] mt-0.5">
            {issue.body.slice(0, 120)}
          </div>
        )}
      </td>

      {/* Labels */}
      <td className="px-3 py-2 w-32">
        <div className="flex flex-wrap gap-1">
          {issue.labels.map((l) => (
            <Badge
              key={l.name}
              variant="outline"
              className="text-[10px]"
              style={
                l.color
                  ? { borderColor: `#${l.color}`, color: `#${l.color}` }
                  : undefined
              }
            >
              {l.name}
            </Badge>
          ))}
        </div>
      </td>

      {/* Author */}
      <td className="px-3 py-2 text-xs text-text-muted w-24 truncate">
        {issue.author}
      </td>

      {/* Date */}
      <td className="px-3 py-2 text-xs text-text-muted w-20">
        {timeAgo(issue.created_at)}
      </td>

      {/* Tackle status */}
      <td className="px-3 py-2 w-8" onClick={(e) => e.stopPropagation()}>
        {tackle && (
          <button
            onClick={() => onClickTackle?.(tackle)}
            className="hover:opacity-80"
            title={`Tackle: ${tackle.status}`}
          >
            {tackleStatusIcon(tackle.status)}
          </button>
        )}
      </td>

      {/* Actions */}
      <td className="px-3 py-2 w-32" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-1">
          {issue.state === "open" && !tackle && onAutoTackle && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-[10px]"
              onClick={() => onAutoTackle(issue)}
              title="Auto Tackle"
            >
              <Zap className="size-3.5" />
            </Button>
          )}

          {issue.state === "open" && onClose && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-text-muted"
              onClick={() => onClose(issue)}
              title="Close"
            >
              <X className="size-3.5" />
            </Button>
          )}

          {issue.state === "closed" && onReopen && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-1.5"
              onClick={() => onReopen(issue)}
              title="Reopen"
            >
              <RotateCw className="size-3.5" />
            </Button>
          )}

          {getIssueUrl && (
            <a
              href={getIssueUrl(issue.number)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center h-6 px-1.5 text-text-muted hover:text-contrast transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="size-3.5" />
            </a>
          )}
        </div>
      </td>
    </tr>
  )
}
