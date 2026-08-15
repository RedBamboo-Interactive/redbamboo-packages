import assert from "node:assert/strict"
import test from "node:test"
import { stripHiddenMessageEnvelopes } from "./message-content.ts"

test("strips Nova context while preserving the authored message", () => {
  const content = `<nova-context source="Nova"><app>RedLeaf</app></nova-context>\nWhat is this?`

  assert.equal(stripHiddenMessageEnvelopes(content), "What is this?")
})

test("strips prior-message transport context", () => {
  const content = `<nova-prior-messages><message>Earlier</message></nova-prior-messages>\nContinue`

  assert.equal(stripHiddenMessageEnvelopes(content), "Continue")
})

test("leaves ordinary user text untouched", () => {
  assert.equal(stripHiddenMessageEnvelopes("Hello Nova"), "Hello Nova")
})
