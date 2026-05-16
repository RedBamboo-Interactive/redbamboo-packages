import { useState, useRef, useEffect, useCallback } from "react"
import {
  RefreshCw,
  Search,
  User,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from "lucide-react"
import {
  Card,
  CardHeader,
  CardContent,
  Button,
  Input,
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@redbamboo/ui"
import type {
  GitRepo,
  GitCommit,
  GitHubPr,
  RepoWorkingState,
} from "../types"
import { useGitHub } from "../contexts/github-context"
import { CommitRow } from "./commit-row"
import { PrRow } from "./pr-row"
import { WorkingStatePanel } from "./working-state-panel"

interface Props {
  repos: GitRepo[]
  commits: GitCommit[]
  pullRequests: GitHubPr[]
  workingState: RepoWorkingState[]
  loading: boolean
  page: number
  totalPages: number
  branchFilter: string
  branches: string[]
  unpushedHashes?: Set<string>

  onPageChange: (page: number) => void
  onBranchChange: (branch: string) => void
  onSearchChange: (search: string) => void
  onAuthorChange: (author: string) => void
  onRefresh: () => void
  onClickCommit?: (commit: GitCommit) => void
  onClickPr?: (pr: GitHubPr) => void
}

export function CommitsTab({
  repos,
  commits,
  pullRequests,
  workingState,
  loading,
  page,
  totalPages,
  branchFilter,
  branches,
  unpushedHashes,
  onPageChange,
  onBranchChange,
  onSearchChange,
  onAuthorChange,
  onRefresh,
  onClickCommit,
  onClickPr,
}: Props) {
  const actions = useGitHub()
  const [searchDraft, setSearchDraft] = useState("")
  const [authorDraft, setAuthorDraft] = useState("")
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const authorTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

  const debouncedSearch = useCallback(
    (value: string) => {
      clearTimeout(searchTimer.current)
      searchTimer.current = setTimeout(() => onSearchChange(value), 300)
    },
    [onSearchChange],
  )

  const debouncedAuthor = useCallback(
    (value: string) => {
      clearTimeout(authorTimer.current)
      authorTimer.current = setTimeout(() => onAuthorChange(value), 300)
    },
    [onAuthorChange],
  )

  useEffect(() => {
    return () => {
      clearTimeout(searchTimer.current)
      clearTimeout(authorTimer.current)
    }
  }, [])

  const fallbackRepo = repos[0]?.name ?? ""

  return (
    <Card className="flex flex-col h-full">
      <CardHeader className="flex-none pb-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Select value={branchFilter} onValueChange={(v: unknown) => onBranchChange(v as string)}>
            <SelectTrigger className="w-44 h-8 text-xs">
              <SelectValue placeholder="Branch" />
            </SelectTrigger>
            <SelectContent>
              {branches.map((b) => (
                <SelectItem key={b} value={b}>
                  {b}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
            <Input
              placeholder="Search commits..."
              className="h-8 pl-7 text-xs w-48"
              value={searchDraft}
              onChange={(e) => {
                setSearchDraft(e.target.value)
                debouncedSearch(e.target.value)
              }}
            />
          </div>

          <div className="relative">
            <User className="absolute left-2 top-1/2 -translate-y-1/2 size-3.5 text-text-muted" />
            <Input
              placeholder="Author..."
              className="h-8 pl-7 text-xs w-36"
              value={authorDraft}
              onChange={(e) => {
                setAuthorDraft(e.target.value)
                debouncedAuthor(e.target.value)
              }}
            />
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            onClick={onRefresh}
            disabled={loading}
          >
            <RefreshCw
              className={`size-3.5 ${loading ? "animate-spin" : ""}`}
            />
          </Button>

          <div className="ml-auto flex items-center gap-1 text-xs text-text-muted">
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

      <WorkingStatePanel repos={workingState} />

      <CardContent className="flex-1 min-h-0 overflow-auto p-0">
        {loading && commits.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-5 animate-spin text-text-muted" />
          </div>
        ) : (
          <table className="w-full text-left">
            <tbody>
              {pullRequests.map((pr) => {
                const tackle =
                  pr.issue_number != null
                    ? (actions.getTackle(pr.issue_number) ??
                      actions.getTackleByPr(pr.number))
                    : actions.getTackleByPr(pr.number)
                const commitHash =
                  tackle?.commit_hash ?? pr.commit_hash ?? ""

                return (
                  <PrRow
                    key={`pr-${pr.number}`}
                    pr={pr}
                    review={
                      commitHash
                        ? actions.getReview(fallbackRepo, commitHash)
                        : undefined
                    }
                    healthCheck={
                      commitHash
                        ? actions.getHc(fallbackRepo, commitHash)
                        : undefined
                    }
                    tackle={tackle}
                    onReview={actions.onReviewPr ? () => actions.onReviewPr!(pr) : undefined}
                    onHealthCheck={actions.onHealthCheckPr ? () => actions.onHealthCheckPr!(pr) : undefined}
                    onApprove={actions.onApproveTackle}
                    onMerge={actions.onMergeTackle}
                    onDismiss={actions.onDismissTackle}
                    onRetackle={actions.onRetackleTackle}
                    onAdopt={!tackle && actions.onAdoptPr ? () => actions.onAdoptPr!(pr) : undefined}
                    onClick={onClickPr}
                  />
                )
              })}

              {commits.map((c) => (
                <CommitRow
                  key={c.hash}
                  commit={c}
                  review={actions.getReview(c.repo_name, c.hash)}
                  healthCheck={actions.getHc(c.repo_name, c.hash)}
                  unpushed={unpushedHashes?.has(c.hash)}
                  onReview={actions.onReviewCommit}
                  onHealthCheck={actions.onHealthCheckCommit}
                  onAlign={actions.onAlignCommit}
                  onClick={onClickCommit}
                />
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
