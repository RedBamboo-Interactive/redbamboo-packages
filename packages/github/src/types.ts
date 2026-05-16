// ── Git ────────────────────────────────────────────────────────────

export interface GitRepo {
  name: string
  path: string
  remote: string
  current_branch: string
  current_hash: string
  is_dirty: boolean
  branches: string[]
  default_branch: string
}

export interface GitCommit {
  hash: string
  short_hash: string
  message: string
  author: string
  date: string
  repo_name: string
}

export interface GitDiffFile {
  path: string
  status: string
  insertions: number
  deletions: number
}

export interface GitDiffStats {
  files_changed: number
  insertions: number
  deletions: number
}

export interface GitDiffResult {
  ok: boolean
  commit: GitCommit
  stats: GitDiffStats
  files: GitDiffFile[]
  raw_diff: string
}

export interface CommitFilters {
  count?: number
  page?: number
  per_page?: number
  author?: string
  search?: string
  since?: string
  branch?: string
}

export interface PaginatedCommitsResponse {
  ok: boolean
  commits: GitCommit[]
  query: { repo: string; filters_applied: string[] }
  page: number
  per_page: number
  total_count: number
  total_pages: number
  has_more: boolean
}

// ── Working State ──────────────────────────────────────────────────

export interface UncommittedFile {
  status: string
  path: string
}

export interface RepoWorkingState {
  name: string
  branch: string
  uncommitted_files: UncommittedFile[]
  unpushed_commits: GitCommit[]
  no_upstream: boolean
  uncommitted_count: number
  unpushed_count: number
}

// ── Pull Requests ──────────────────────────────────────────────────

export interface GitHubPr {
  number: number
  title: string
  head_branch: string
  base_branch: string
  author: string
  url: string
  created_at: string
  commit_hash: string | null
  issue_number: number | null
  issue_title: string | null
  tackle_id: string | null
  tackle_status: string | null
  is_tackle: boolean
}

// ── Issues ─────────────────────────────────────────────────────────

export interface IssueLabel {
  name: string
  color: string
}

export interface GitHubIssue {
  number: number
  title: string
  state: string
  labels: IssueLabel[]
  author: string
  created_at: string
  updated_at: string
  body: string
}

export interface IssueFilters {
  state?: "open" | "closed" | "all"
  labels?: string
  limit?: number
  page?: number
  per_page?: number
}

export interface PaginatedIssuesResponse {
  ok: boolean
  issues: GitHubIssue[]
  page: number
  per_page: number
  total_count: number
  total_pages: number
  has_more: boolean
}

export interface IssueCreateRequest {
  title: string
  description: string
  type: "bug" | "feature" | "other"
  labels: string[]
}

// ── Reviews ────────────────────────────────────────────────────────

export type ReviewVerdict = "pass" | "pass_with_notes" | "reject" | "pending_human"
export type ReviewStatus = "pending" | "running" | "completed" | "failed"

export interface ReviewFinding {
  severity: "error" | "warn" | "info"
  category: string
  file: string
  description: string
  mitigated_by?: string
}

export interface ReviewTestSuite {
  ran: boolean
  passed: boolean | null
  output_snippet: string
}

export interface ReviewCheck {
  pass: boolean
  notes: string
}

export interface Review {
  id: string
  repo_name: string
  commit_hash: string
  short_hash: string
  commit_message: string
  verdict: ReviewVerdict | null
  status: ReviewStatus
  summary: string | null
  commit_intent: string | null
  findings: ReviewFinding[]
  test_results: Record<string, ReviewTestSuite>
  checks: Record<string, ReviewCheck>
  created_issue_urls: string[]
  session_id: string | null
  tackle_id: string | null
  error_message: string | null
  started_at: string
  completed_at: string | null
}

// ── Tackles ────────────────────────────────────────────────────────

export type TackleStatus =
  | "pending"
  | "running"
  | "awaiting_review"
  | "awaiting_merge"
  | "awaiting_human_loop"
  | "merging"
  | "merged"
  | "failed"
  | "dismissed"

export type TackleMode = "automated" | "manual"

export interface TackleRun {
  id: string
  issue_number: number | null
  issue_title: string | null
  repo_name: string
  branch_name: string | null
  commit_hash: string | null
  pull_request_url: string | null
  pull_request_number: number | null
  status: TackleStatus
  mode: TackleMode
  model: string | null
  review_id: string | null
  human_approved: boolean
  ai_approved: boolean
  error_message: string | null
  started_at: string
  completed_at: string | null
}

export interface TackleStartOptions {
  mode: TackleMode
  model?: string
}

// ── Health Checks ──────────────────────────────────────────────────

export type HealthCheckVerdict = "healthy" | "degraded"

export interface HealthCheckSuiteResult {
  run_id: string
  suite: string
  display_name: string
  framework: string
  passed: boolean
  total: number
  passed_count: number
  failed_count: number
  skipped_count: number
  duration_seconds: number
  failing_tests: string[]
  error?: string
}

export interface HealthCheckResult {
  id: string
  repo_name: string
  commit_hash: string
  status: "pending" | "running" | "completed" | "failed"
  verdict: HealthCheckVerdict | null
  total_suites: number
  passed_suites: number
  failed_suites: number
  suite_results: Record<string, HealthCheckSuiteResult>
  error_message: string | null
  started_at: string
  completed_at: string | null
}

// ── Tests ──────────────────────────────────────────────────────────

export interface TestSuiteDefinition {
  key: string
  display_name: string
  category: string
  framework: string
  live_progress: boolean
  latest_run?: TestRun
}

export interface TestRun {
  id: string
  suite: string
  category: string
  status: "pending" | "running" | "completed" | "failed"
  passed: boolean | null
  total_tests: number
  passed_count: number
  failed_count: number
  skipped_count: number
  duration_seconds: number
  branch: string
  commit_sha: string
  error_message: string | null
  started_at: string
  completed_at: string | null
}

export interface TestHistoryRun {
  run_id: string
  status: string
  duration_ms: number
  started_at: string
  branch: string
  commit_sha: string
  sandbox_id?: string
}

// ── Fetcher ────────────────────────────────────────────────────────

export interface Fetcher {
  get: <T>(path: string) => Promise<T>
  post: <T>(path: string, body?: unknown) => Promise<T>
  postStream?: (path: string, body?: unknown) => Promise<Response>
}

export interface GitHubClientConfig {
  rootPath: string
  repo?: string
}
