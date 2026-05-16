import { Badge } from "@redbamboo/ui"
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
      className="border-b border-overlay-6 hover:bg-overlay-5 transition-colors cursor-pointer"
      onClick={() => onClick?.(issue)}
    >
      <td className="px-3 py-2 w-20">
        <span className="flex items-center gap-1.5">
          {issueTypeIcon(issue.labels)}
          <span className="text-xs font-medium text-text-muted">
            #{issue.number}
          </span>
        </span>
      </td>

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

      <td className="px-3 py-2 text-xs text-text-muted w-24 truncate">
        {issue.author}
      </td>

      <td className="px-3 py-2 text-xs text-text-muted w-20">
        {timeAgo(issue.created_at)}
      </td>

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

      <td className="px-3 py-2 w-32" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-0.5">
          {issue.state === "open" && !tackle && onAutoTackle && (
            <button onClick={() => onAutoTackle(issue)} title="Auto Tackle" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-bolt text-[11px] text-text-muted opacity-60" />
            </button>
          )}

          {issue.state === "open" && onClose && (
            <button onClick={() => onClose(issue)} title="Close" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-xmark text-[11px] text-text-muted opacity-60" />
            </button>
          )}

          {issue.state === "closed" && onReopen && (
            <button onClick={() => onReopen(issue)} title="Reopen" className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors">
              <i className="fa-solid fa-rotate-right text-[11px] text-text-muted opacity-60" />
            </button>
          )}

          {getIssueUrl && (
            <a
              href={getIssueUrl(issue.number)}
              target="_blank"
              rel="noopener noreferrer"
              className="w-7 h-7 flex items-center justify-center rounded hover:bg-overlay-10 transition-colors"
              onClick={(e) => e.stopPropagation()}
            >
              <i className="fa-solid fa-arrow-up-right-from-square text-[10px] text-text-muted opacity-60" />
            </a>
          )}
        </div>
      </td>
    </tr>
  )
}
