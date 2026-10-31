import { test } from "node:test"
import assert from "node:assert/strict"
import type { ContextMenuEntry, ContextMenuRunContext } from "@redbamboo/ui"
import type { GitCommit, GitHubIssue, GitHubPr, TackleRun } from "../types"
import { commitRowEntries, issueRowEntries, prRowEntries, tackleFlags } from "./row-actions.ts"

const noop = () => {}
const ids = (entries: ContextMenuEntry[]) => entries.map((entry) => entry.id)
const item = (entries: ContextMenuEntry[], id: string) => {
  const found = entries.find((entry) => entry.id === id)
  assert.ok(found && !("separator" in found), `no item ${id}`)
  return found
}
function runContext() {
  const copied: string[] = []
  const opened: string[] = []
  const ctx = {
    target: null, origin: null, surface: "context-menu", document: {}, navigate: noop,
    window: { open: (url: string) => { opened.push(url); return null } },
    copyText: async (text: string) => { copied.push(text); return true },
  } as unknown as ContextMenuRunContext
  return { ctx, copied, opened }
}

const commit: GitCommit = { hash: "abc1234def", short_hash: "abc1234", message: "Fix it", author: "L", date: "2026-10-31T10:00:00Z", repo_name: "redleaf" }
const pr: GitHubPr = {
  number: 7, title: "Feature", head_branch: "feat/x", base_branch: "main", author: "L", url: "https://github.com/o/r/pull/7",
  created_at: "2026-10-31T10:00:00Z", commit_hash: "abc", issue_number: null, issue_title: null, tackle_id: null, tackle_status: null, is_tackle: false,
}
const issue: GitHubIssue = { number: 12, title: "Bug", state: "open", labels: [], author: "L", created_at: "", updated_at: "", body: "" }
const tackle = (status: string, extra: Partial<TackleRun> = {}) => ({ id: "t1", status, ...extra }) as TackleRun

test("a commit row offers the row's inline actions, then copy", () => {
  const entries = commitRowEntries({ commit, onClick: noop, onReview: noop, onHealthCheck: noop, onAlign: noop })
  assert.deepEqual(ids(entries), ["open", "review", "health-check", "align", "copy-separator", "copy-hash", "copy-message"])
  assert.deepEqual(ids(commitRowEntries({ commit })), ["copy-separator", "copy-hash", "copy-message"])
})

test("commit copy items copy the full hash and the message", () => {
  const { ctx, copied } = runContext()
  const entries = commitRowEntries({ commit })
  void item(entries, "copy-hash").run!(ctx)
  void item(entries, "copy-message").run!(ctx)
  assert.deepEqual(copied, ["abc1234def", "Fix it"])
})

test("reviews and health checks open only when the row shows one", () => {
  const review = { id: "r" } as never
  const healthCheck = { id: "h" } as never
  const opened: unknown[] = []
  const entries = commitRowEntries({ commit, review, healthCheck, onClickReview: (r) => opened.push(r), onClickHealthCheck: (h) => opened.push(h) })
  assert.deepEqual(ids(entries).slice(0, 2), ["open-review", "open-health-check"])
  void item(entries, "open-review").run!(runContext().ctx)
  assert.deepEqual(opened, [review])
  assert.ok(!ids(commitRowEntries({ commit, onClickReview: noop })).includes("open-review"))
})

test("tackle flags match the inline buttons' conditions", () => {
  assert.deepEqual(tackleFlags(undefined), { canApprove: false, canMerge: false, isBusy: false, canDismiss: false, canRetackle: false })
  assert.equal(tackleFlags(tackle("awaiting_review", { ai_approved: true, human_approved: false })).canApprove, true)
  assert.equal(tackleFlags(tackle("awaiting_review", { ai_approved: true, human_approved: true })).canApprove, false)
  assert.equal(tackleFlags(tackle("awaiting_merge")).canMerge, true)
  for (const busy of ["pending", "running", "merging"]) {
    assert.equal(tackleFlags(tackle(busy)).isBusy, true)
    assert.equal(tackleFlags(tackle(busy)).canDismiss, false)
  }
  assert.equal(tackleFlags(tackle("merged")).canDismiss, false)
  assert.equal(tackleFlags(tackle("dismissed")).canRetackle, true)
})

test("an untackled pull request offers Adopt and GitHub links", () => {
  const entries = prRowEntries({ pr, onReview: noop, onHealthCheck: noop, onAdopt: noop, onApprove: noop, onDismiss: noop })
  assert.deepEqual(ids(entries), ["open-github", "work-separator", "adopt", "review", "health-check", "copy-separator", "copy-link", "copy-branch"])
  const { ctx, opened, copied } = runContext()
  void item(entries, "open-github").run!(ctx)
  void item(entries, "copy-branch").run!(ctx)
  assert.deepEqual(opened, ["https://github.com/o/r/pull/7"])
  assert.deepEqual(copied, ["feat/x"])
})

test("a tackled pull request offers what its status allows", () => {
  const all = { onApprove: noop, onMerge: noop, onDismiss: noop, onRetackle: noop, onAdopt: noop, onClickTackle: noop }
  const work = (status: string, extra: Partial<TackleRun> = {}) =>
    ids(prRowEntries({ pr, tackle: tackle(status, extra), ...all })).filter((id) => ["approve", "merge", "dismiss", "retackle", "adopt"].includes(id))
  assert.deepEqual(work("awaiting_review", { ai_approved: true }), ["approve", "dismiss"])
  assert.deepEqual(work("awaiting_merge"), ["merge", "dismiss"])
  assert.deepEqual(work("running"), [])
  assert.deepEqual(work("dismissed"), ["dismiss", "retackle"])
  assert.ok(ids(prRowEntries({ pr, tackle: tackle("running"), ...all })).includes("open-tackle"))
})

test("an issue offers tackle, close or reopen by state, and GitHub only with a real URL", () => {
  const handlers = { onClick: noop, onAutoTackle: noop, onClose: noop, onReopen: noop, getIssueUrl: (n: number) => `https://github.com/o/r/issues/${n}` }
  assert.deepEqual(ids(issueRowEntries({ issue, ...handlers })),
    ["open", "open-github", "work-separator", "auto-tackle", "close", "copy-separator", "copy-link", "copy-number"])
  assert.deepEqual(ids(issueRowEntries({ issue: { ...issue, state: "closed" }, ...handlers })),
    ["open", "open-github", "work-separator", "reopen", "copy-separator", "copy-link", "copy-number"])
  // No repository slug: the page hands out "#", which is not a link.
  assert.deepEqual(ids(issueRowEntries({ issue, getIssueUrl: () => "#" })), ["copy-separator", "copy-number"])
  // A running tackle replaces Auto Tackle.
  assert.ok(!ids(issueRowEntries({ issue, tackle: tackle("running"), ...handlers })).includes("auto-tackle"))
})
