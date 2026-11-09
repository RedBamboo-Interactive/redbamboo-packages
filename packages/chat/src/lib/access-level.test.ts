import assert from "node:assert/strict"
import test from "node:test"
import { ACCESS_LEVEL_DESCRIPTIONS, accessLevelChoices } from "./access-level.ts"

const reasons = (choices: ReturnType<typeof accessLevelChoices>) =>
  Object.fromEntries(choices.map(choice => [choice.level, choice.disabledReason]))

test("only supported levels are offered, in canonical order, unknown values dropped", () => {
  const choices = accessLevelChoices({ supported: ["full", "ask", "bypassPermissions"] })
  assert.deepEqual(choices.map(choice => choice.level), ["ask", "full"])
})

test("Full is disabled only when the host says it is not enabled", () => {
  assert.equal(reasons(accessLevelChoices({ supported: ["ask", "full"], fullAccessEnabled: false })).full, "full_access_not_enabled")
  assert.equal(reasons(accessLevelChoices({ supported: ["ask", "full"], fullAccessEnabled: true })).full, null)
  assert.equal(reasons(accessLevelChoices({ supported: ["ask", "full"] })).full, null)
})

test("levels above the session cap are disabled", () => {
  assert.deepEqual(reasons(accessLevelChoices({ supported: ["plan", "ask", "auto", "full"], max: "auto", fullAccessEnabled: true })), {
    plan: null, ask: null, auto: null, full: "above_session_cap",
  })
  assert.deepEqual(reasons(accessLevelChoices({ supported: ["plan", "ask", "auto", "full"], max: "ask" })), {
    plan: null, ask: null, auto: "above_session_cap", full: "above_session_cap",
  })
})

test("no supported levels means no row", () => {
  assert.deepEqual(accessLevelChoices({ supported: undefined }), [])
  assert.deepEqual(accessLevelChoices({ supported: [] }), [])
})

test("the description copy is exactly what was agreed", () => {
  assert.deepEqual(ACCESS_LEVEL_DESCRIPTIONS, {
    plan: "Reads and plans, changes nothing.",
    ask: "Edits files in the project, asks before anything else.",
    auto: "A safety check approves routine actions and blocks risky ones.",
    full: "Runs everything without asking.",
  })
})
