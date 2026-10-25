import { test } from "node:test"
import assert from "node:assert/strict"
import { delegationPlacement } from "./delegation-placement.ts"

test("old marker shows the repository alone", () => {
  assert.deepEqual(delegationPlacement({ repository: "nova" }), { label: "nova", worktree: false })
})

test("checkout session with null branch and worktree path is unchanged", () => {
  assert.deepEqual(
    delegationPlacement({ repository: "nova", branch: null, worktreePath: null }),
    { label: "nova", worktree: false },
  )
})

test("branch is appended to the repository", () => {
  assert.deepEqual(
    delegationPlacement({ repository: "songes", branch: "feature/x" }),
    { label: "songes · feature/x", worktree: false },
  )
})

test("a worktree path marks the placement as a worktree", () => {
  assert.deepEqual(
    delegationPlacement({ repository: "songes", branch: "feature/x", worktreePath: "T:/p/songes.worktrees/feature-x" }),
    { label: "songes · feature/x", worktree: true },
  )
})

test("blank and non-string values are ignored", () => {
  assert.deepEqual(
    delegationPlacement({ repository: "songes", branch: "  ", worktreePath: 3 }),
    { label: "songes", worktree: false },
  )
})

test("branch without a repository still labels", () => {
  assert.deepEqual(delegationPlacement({ branch: "main" }), { label: "main", worktree: false })
})

test("nothing to show yields undefined", () => {
  assert.equal(delegationPlacement({}), undefined)
  assert.equal(delegationPlacement(null), undefined)
})
