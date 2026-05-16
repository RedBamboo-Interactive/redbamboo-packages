import {
  Plus,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import {
  Card,
  CardHeader,
  CardContent,
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
    <Card className="flex flex-col h-full">
      <CardHeader className="flex-none pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Tabs
            value={stateFilter}
            onValueChange={(v) =>
              onStateFilterChange(v as "open" | "closed" | "all")
            }
          >
            <TabsList className="h-8">
              <TabsTrigger value="open" className="text-xs px-2.5">
                Open
              </TabsTrigger>
              <TabsTrigger value="closed" className="text-xs px-2.5">
                Closed
              </TabsTrigger>
              <TabsTrigger value="all" className="text-xs px-2.5">
                All
              </TabsTrigger>
            </TabsList>
          </Tabs>

          <Tabs
            value={labelFilter}
            onValueChange={onLabelFilterChange}
          >
            <TabsList className="h-8">
              <TabsTrigger value="" className="text-xs px-2.5">
                All
              </TabsTrigger>
              <TabsTrigger value="bug" className="text-xs px-2.5">
                Bug
              </TabsTrigger>
              <TabsTrigger
                value="feature-request"
                className="text-xs px-2.5"
              >
                Feature
              </TabsTrigger>
              <TabsTrigger
                value="ai-reported"
                className="text-xs px-2.5"
              >
                AI
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {onNewIssue && (
            <Button
              variant="outline"
              size="sm"
              className="h-8 ml-auto"
              onClick={onNewIssue}
            >
              <Plus className="size-3.5 mr-1" />
              New Issue
            </Button>
          )}

          <div className="flex items-center gap-1 text-xs text-text-muted ml-auto">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span>
              {page} / {totalPages || 1}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 overflow-auto p-0">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-text-muted" />
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
                  onClickTackle={actions.onClickTackle}
                  getIssueUrl={actions.getIssueUrl}
                />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
