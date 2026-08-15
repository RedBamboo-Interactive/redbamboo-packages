import test from "node:test"
import assert from "node:assert/strict"
import { parseNovaEvent } from "./nova-event.ts"

test("parses a Nova event carrier", () => {
  assert.deepEqual(
    parseNovaEvent('<nova-event source="automation:heartbeat" type="ai-session">\nCompleted\n</nova-event>'),
    { source: "automation:heartbeat", type: "ai-session", content: "Completed" },
  )
})

test("uses event defaults and rejects ordinary messages", () => {
  assert.deepEqual(
    parseNovaEvent("<nova-event data-id=\"1\">Done</nova-event>"),
    { source: "automation", type: "generic", content: "Done" },
  )
  assert.equal(parseNovaEvent("ordinary message"), null)
})
