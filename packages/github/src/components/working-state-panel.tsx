import { FileWarning, ArrowUp } from "lucide-react"
import type { RepoWorkingState } from "../types"

interface Props {
  repos: RepoWorkingState[]
  onViewFiles?: (repo: RepoWorkingState) => void
}

export function WorkingStatePanel({ repos, onViewFiles }: Props) {
  const totalUncommitted = repos.reduce((n, r) => n + r.uncommitted_count, 0)
  const totalUnpushed = repos.reduce((n, r) => n + r.unpushed_count, 0)

  if (totalUncommitted === 0 && totalUnpushed === 0) return null

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 text-xs text-text-muted border-b border-border">
      {totalUncommitted > 0 && (
        <button
          className="flex items-center gap-1 hover:text-contrast transition-colors"
          onClick={() => repos.length === 1 && onViewFiles?.(repos[0]!)}
        >
          <FileWarning className="size-3.5 text-amber-400" />
          <span>
            {totalUncommitted} uncommitted file
            {totalUncommitted !== 1 ? "s" : ""}
          </span>
        </button>
      )}
      {totalUnpushed > 0 && (
        <span className="flex items-center gap-1">
          <ArrowUp className="size-3.5 text-blue-400" />
          <span>
            {totalUnpushed} unpushed commit
            {totalUnpushed !== 1 ? "s" : ""}
          </span>
        </span>
      )}
    </div>
  )
}
