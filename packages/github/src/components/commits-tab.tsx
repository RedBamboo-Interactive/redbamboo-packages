import { useState, useRef, useEffect, useCallback } from "react"
import {
  Badge,
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
import { GhostHash } from "./ghost-hash"
import { PrRow } from "./pr-row"

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
  onRefresh?: () => void
  onClickCommit?: (commit: GitCommit) => void
  onClickUncommitted?: (repo: RepoWorkingState) => void
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
  onClickCommit,
  onClickUncommitted,
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
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b border-overlay-6 flex-none">
        <Select value={branchFilter} onValueChange={(v: unknown) => onBranchChange(v as string)}>
          <SelectTrigger className="w-40 h-7 text-xs">
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
          <i className="fa-solid fa-search absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-text-muted" />
          <Input
            placeholder="Search commits..."
            className="h-7 pl-7 text-xs w-44"
            value={searchDraft}
            onChange={(e) => {
              setSearchDraft(e.target.value)
              debouncedSearch(e.target.value)
            }}
          />
        </div>

        <div className="relative">
          <i className="fa-solid fa-user absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-text-muted" />
          <Input
            placeholder="Author..."
            className="h-7 pl-7 text-xs w-32"
            value={authorDraft}
            onChange={(e) => {
              setAuthorDraft(e.target.value)
              debouncedAuthor(e.target.value)
            }}
          />
        </div>

        <div className="ml-auto flex items-center gap-1 text-xs text-text-muted">
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
        {loading && commits.length === 0 ? (
          <div className="flex items-center justify-center py-12">
            <i className="fa-solid fa-spinner fa-spin text-text-muted" />
          </div>
        ) : (
          <table className="w-full text-left">
            <tbody>
              {workingState
                .filter((r) => r.uncommitted_count > 0)
                .map((r) => (
                  <tr
                    key={`uncommitted-${r.name}`}
                    className="border-b border-overlay-6 bg-overlay-3 hover:bg-overlay-5 transition-colors cursor-pointer"
                    onClick={() => onClickUncommitted?.(r)}
                  >
                    <td className="px-3 py-2 w-28">
                      <Badge variant="outline" className="text-[10px]">
                        {r.name}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 w-20">
                      <GhostHash />
                    </td>
                    <td className="px-3 py-2 text-sm truncate max-w-[400px] italic text-text-disabled">
                      {r.uncommitted_count} uncommitted file
                      {r.uncommitted_count !== 1 ? "s" : ""}
                    </td>
                    <td className="px-3 py-2 text-xs text-text-disabled w-28 truncate">
                      —
                    </td>
                    <td className="px-3 py-2 text-xs text-text-disabled w-20">
                      now
                    </td>
                    <td className="px-3 py-2 w-8" />
                    <td className="px-3 py-2 w-8" />
                    <td className="px-3 py-2 w-24" />
                  </tr>
                ))}

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
      </div>
    </div>
  )
}
