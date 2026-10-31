// Commit, pull request and issue row actions as descriptors for the rows'
// right-click and long-press menu. They offer the same actions, under the same
// conditions, as the rows' inline buttons, plus open and copy. Type-only
// imports, so node tests load it directly.
import type { ContextMenuEntry } from "@redbamboo/ui"
import type { GitCommit, GitHubIssue, GitHubPr, HealthCheckResult, Review, TackleRun } from "../types"

/** When a pull request's tackle can be approved, merged or dismissed (shared with the inline buttons). */
export function tackleFlags(tackle: TackleRun | undefined) {
  const canApprove = !!tackle && tackle.status === "awaiting_review" && !!tackle.ai_approved && !tackle.human_approved
  const canMerge = !!tackle && tackle.status === "awaiting_merge"
  const isBusy = !!tackle && (tackle.status === "pending" || tackle.status === "running" || tackle.status === "merging")
  const canDismiss = !!tackle && !isBusy && tackle.status !== "merged"
  const canRetackle = tackle?.status === "dismissed"
  return { canApprove, canMerge, isBusy, canDismiss, canRetackle }
}

/** Opens a review or health check that a row shows (from the GitHub context). */
export interface RowResultActions {
  review?: Review
  healthCheck?: HealthCheckResult
  onClickReview?: (review: Review) => void
  onClickHealthCheck?: (healthCheck: HealthCheckResult) => void
}

function resultEntries({ review, healthCheck, onClickReview, onClickHealthCheck }: RowResultActions): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = []
  if (review && onClickReview) entries.push({ id: "open-review", label: "Open review", icon: "ph-bold ph-article", run: () => onClickReview(review) })
  if (healthCheck && onClickHealthCheck) entries.push({ id: "open-health-check", label: "Open health check", icon: "ph-bold ph-heartbeat", run: () => onClickHealthCheck(healthCheck) })
  return entries
}

function copyEntry(id: string, label: string, text: string, icon = "ph-bold ph-copy"): ContextMenuEntry {
  return { id, label, icon, run: (ctx) => { void ctx.copyText(text) } }
}

function githubEntries(url: string | undefined): ContextMenuEntry[] {
  if (!url || url === "#") return []
  return [{ id: "open-github", label: "Open on GitHub", icon: "ph-bold ph-github-logo", run: (ctx) => { ctx.window.open(url, "_blank", "noopener,noreferrer") } }]
}

export interface CommitRowActions extends RowResultActions {
  commit: GitCommit
  onClick?: (commit: GitCommit) => void
  onReview?: (commit: GitCommit) => void
  onHealthCheck?: (commit: GitCommit) => void
  onAlign?: (commit: GitCommit) => void
}

export function commitRowEntries(actions: CommitRowActions): ContextMenuEntry[] {
  const { commit, onClick, onReview, onHealthCheck, onAlign } = actions
  const entries: ContextMenuEntry[] = []
  if (onClick) entries.push({ id: "open", label: "Open commit", icon: "ph-bold ph-git-commit", run: () => onClick(commit) })
  if (onReview) entries.push({ id: "review", label: "Auto Review", icon: "ph-bold ph-robot", run: () => onReview(commit) })
  if (onHealthCheck) entries.push({ id: "health-check", label: "Health Check", icon: "ph-bold ph-flask", run: () => onHealthCheck(commit) })
  if (onAlign) entries.push({ id: "align", label: "Align to revision", icon: "ph-bold ph-play", run: () => onAlign(commit) })
  entries.push(...resultEntries(actions))
  entries.push(
    { id: "copy-separator", separator: true },
    copyEntry("copy-hash", "Copy commit hash", commit.hash, "ph-bold ph-hash"),
    copyEntry("copy-message", "Copy message", commit.message, "ph-bold ph-text-align-left"),
  )
  return entries
}

export interface PrRowActions extends RowResultActions {
  pr: GitHubPr
  tackle?: TackleRun
  onClick?: (pr: GitHubPr) => void
  onReview?: (pr: GitHubPr) => void
  onHealthCheck?: (pr: GitHubPr) => void
  onApprove?: (tackle: TackleRun) => void
  onMerge?: (tackle: TackleRun) => void
  onDismiss?: (tackle: TackleRun) => void
  onRetackle?: (tackle: TackleRun) => void
  onAdopt?: (pr: GitHubPr) => void
  onClickTackle?: (tackle: TackleRun) => void
}

export function prRowEntries(actions: PrRowActions): ContextMenuEntry[] {
  const { pr, tackle, onClick, onReview, onHealthCheck, onApprove, onMerge, onDismiss, onRetackle, onAdopt, onClickTackle } = actions
  const { canApprove, canMerge, canDismiss, canRetackle } = tackleFlags(tackle)
  const entries: ContextMenuEntry[] = []
  if (onClick) entries.push({ id: "open", label: "Open pull request", icon: "ph-bold ph-git-pull-request", run: () => onClick(pr) })
  entries.push(...githubEntries(pr.url))
  if (tackle && onClickTackle) entries.push({ id: "open-tackle", label: "Open tackle", icon: "ph-bold ph-lightning", run: () => onClickTackle(tackle) })
  entries.push(...resultEntries(actions))
  const work: ContextMenuEntry[] = []
  if (!tackle && onAdopt) work.push({ id: "adopt", label: "Adopt", icon: "ph-bold ph-hand-grabbing", run: () => onAdopt(pr) })
  if (onReview) work.push({ id: "review", label: "Auto Review", icon: "ph-bold ph-robot", run: () => onReview(pr) })
  if (onHealthCheck) work.push({ id: "health-check", label: "Health Check", icon: "ph-bold ph-flask", run: () => onHealthCheck(pr) })
  if (tackle && canApprove && onApprove) work.push({ id: "approve", label: "Approve", icon: "ph-bold ph-check", run: () => onApprove(tackle) })
  if (tackle && canMerge && onMerge) work.push({ id: "merge", label: "Merge", icon: "ph-bold ph-git-merge", run: () => onMerge(tackle) })
  if (tackle && canDismiss && onDismiss) work.push({ id: "dismiss", label: "Dismiss", icon: "ph-bold ph-x", run: () => onDismiss(tackle) })
  if (tackle && canRetackle && onRetackle) work.push({ id: "retackle", label: "Re-tackle", icon: "ph-bold ph-arrow-counter-clockwise", run: () => onRetackle(tackle) })
  if (work.length > 0) entries.push({ id: "work-separator", separator: true }, ...work)
  entries.push({ id: "copy-separator", separator: true })
  if (pr.url) entries.push(copyEntry("copy-link", "Copy link", pr.url, "ph-bold ph-link"))
  entries.push(copyEntry("copy-branch", "Copy branch name", pr.head_branch, "ph-bold ph-git-branch"))
  return entries
}

export interface IssueRowActions {
  issue: GitHubIssue
  tackle?: TackleRun
  onClick?: (issue: GitHubIssue) => void
  onAutoTackle?: (issue: GitHubIssue) => void
  onClose?: (issue: GitHubIssue) => void
  onReopen?: (issue: GitHubIssue) => void
  onClickTackle?: (tackle: TackleRun) => void
  getIssueUrl?: (number: number) => string
}

export function issueRowEntries({ issue, tackle, onClick, onAutoTackle, onClose, onReopen, onClickTackle, getIssueUrl }: IssueRowActions): ContextMenuEntry[] {
  const url = getIssueUrl?.(issue.number)
  const open = issue.state === "open"
  const entries: ContextMenuEntry[] = []
  if (onClick) entries.push({ id: "open", label: "Open issue", icon: "ph-bold ph-circle-dashed", run: () => onClick(issue) })
  entries.push(...githubEntries(url))
  if (tackle && onClickTackle) entries.push({ id: "open-tackle", label: "Open tackle", icon: "ph-bold ph-lightning", run: () => onClickTackle(tackle) })
  const work: ContextMenuEntry[] = []
  if (open && !tackle && onAutoTackle) work.push({ id: "auto-tackle", label: "Auto Tackle", icon: "ph-bold ph-lightning", run: () => onAutoTackle(issue) })
  if (open && onClose) work.push({ id: "close", label: "Close issue", icon: "ph-bold ph-x", run: () => onClose(issue) })
  if (issue.state === "closed" && onReopen) work.push({ id: "reopen", label: "Reopen", icon: "ph-bold ph-arrow-clockwise", run: () => onReopen(issue) })
  if (work.length > 0) entries.push({ id: "work-separator", separator: true }, ...work)
  entries.push({ id: "copy-separator", separator: true })
  if (url && url !== "#") entries.push(copyEntry("copy-link", "Copy link", url, "ph-bold ph-link"))
  entries.push(copyEntry("copy-number", "Copy issue number", `#${issue.number}`, "ph-bold ph-hash"))
  return entries
}
