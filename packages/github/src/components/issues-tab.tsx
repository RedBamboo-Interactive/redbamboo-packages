import {
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@redbamboo/ui"
import type { GitHubIssue } from "../types"
import { useGitHub } from "../contexts/github-context"
import { IssueRow } from "./issue-row"

interface Props {
  issues: GitHubIssue[]
  loading: boolean
  page: number
  totalPages: number
  stateFilter: "open" | "closed" | "all"
  labelFilter: string

  onStateFilterChange: (state: "open" | "closed" | "all") => void
  onLabelFilterChange: (label: string) => void
  onPageChange: (page: number) => void
  onNewIssue?: () => void
}

export function IssuesTab({
  issues,
  loading,
  page,
  totalPages,
  stateFilter,
  labelFilter,
  onStateFilterChange,
  onLabelFilterChange,
  onPageChange,
  onNewIssue,
}: Props) {
  const actions = useGitHub()

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-overlay-6 flex-none">
        <Tabs
          value={stateFilter}
          onValueChange={(v) =>
            onStateFilterChange(v as "open" | "closed" | "all")
          }
        >
          <TabsList className="h-7">
            <TabsTrigger value="open" className="text-xs px-2">
              Open
            </TabsTrigger>
            <TabsTrigger value="closed" className="text-xs px-2">
              Closed
            </TabsTrigger>
            <TabsTrigger value="all" className="text-xs px-2">
              All
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <Tabs
          value={labelFilter}
          onValueChange={onLabelFilterChange}
        >
          <TabsList className="h-7">
            <TabsTrigger value="" className="text-xs px-2">
              All
            </TabsTrigger>
            <TabsTrigger value="bug" className="text-xs px-2">
              Bug
            </TabsTrigger>
            <TabsTrigger
              value="feature-request"
              className="text-xs px-2"
            >
              Feature
            </TabsTrigger>
            <TabsTrigger
              value="ai-reported"
              className="text-xs px-2"
            >
              AI
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {onNewIssue && (
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs ml-auto"
            onClick={onNewIssue}
          >
            <i className="fa-solid fa-plus text-[10px] mr-1" />
            New Issue
          </Button>
        )}

        <div className="flex items-center gap-1 text-xs text-text-muted ml-auto">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <i className="fa-solid fa-chevron-left text-[10px]" />
          </Button>
          <span className="text-[11px] tabular-nums">
            {page}/{totalPages || 1}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <i className="fa-solid fa-chevron-right text-[10px]" />
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <i className="fa-solid fa-spinner fa-spin text-text-muted" />
          </div>
        ) : issues.length === 0 ? (
          <div className="flex items-center justify-center py-12 text-sm text-text-muted">
            No issues found
          </div>
        ) : (
          <table className="w-full text-left">
            <tbody>
              {issues.map((issue) => (
                <IssueRow
                  key={issue.number}
                  issue={issue}
                  tackle={actions.getTackle(issue.number)}
                  onAutoTackle={actions.onAutoTackle}
                  onClose={actions.onCloseIssue}
                  onReopen={actions.onReopenIssue}
                  onClick={actions.onClickIssue}
                  onClickTackle={actions.onClickTackle}
                  getIssueUrl={actions.getIssueUrl}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
