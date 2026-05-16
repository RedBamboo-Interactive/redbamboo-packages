import { createContext, useContext } from "react"
import type { Review, HealthCheckResult, TackleRun, GitCommit, GitHubPr, GitHubIssue } from "../types"

export interface GitHubActions {
  getReview: (repo: string, hash: string) => Review | undefined
  getHc: (repo: string, hash: string) => HealthCheckResult | undefined
  getTackle: (issueNumber: number) => TackleRun | undefined
  getTackleByPr: (prNumber: number) => TackleRun | undefined
  getTackleById: (tackleId: string) => TackleRun | undefined

  onReviewCommit?: (commit: GitCommit) => void
  onHealthCheckCommit?: (commit: GitCommit) => void
  onAlignCommit?: (commit: GitCommit) => void

  onReviewPr?: (pr: GitHubPr) => void
  onHealthCheckPr?: (pr: GitHubPr) => void
  onApproveTackle?: (tackle: TackleRun) => void
  onMergeTackle?: (tackle: TackleRun) => void
  onDismissTackle?: (tackle: TackleRun) => void
  onRetackleTackle?: (tackle: TackleRun) => void
  onAdoptPr?: (pr: GitHubPr) => void

  onClickReview?: (review: Review) => void
  onClickHealthCheck?: (hc: HealthCheckResult) => void

  onAutoTackle?: (issue: GitHubIssue) => void
  onCloseIssue?: (issue: GitHubIssue) => void
  onReopenIssue?: (issue: GitHubIssue) => void
  onClickIssue?: (issue: GitHubIssue) => void
  onClickTackle?: (tackle: TackleRun) => void

  getIssueUrl?: (number: number) => string
}

const noop = () => undefined

const defaultActions: GitHubActions = {
  getReview: noop,
  getHc: noop,
  getTackle: noop,
  getTackleByPr: noop,
  getTackleById: noop,
}

export const GitHubContext = createContext<GitHubActions>(defaultActions)

export function useGitHub() {
  return useContext(GitHubContext)
}
