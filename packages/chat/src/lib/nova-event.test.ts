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

test("tolerates the attributes that say who sent an event", () => {
  assert.deepEqual(
    parseNovaEvent('<nova-event source="agent-note" from-agent="Nova" from-agent-id="id-1" from-discussion="94453f76" from-title="Tom &amp; Jerry &quot;plans&quot; &lt;x&gt;">\nDone\n</nova-event>'),
    { source: "agent-note", type: "generic", content: "Done" },
  )
})
