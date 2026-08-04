import assert from "node:assert/strict"
import test from "node:test"
import { getSessionResourceHref } from "./session-resource-links.ts"

test("session resource links target their canonical suite detail views", () => {
  assert.equal(
    getSessionResourceHref("job", "57483355-abcd"),
    "/apps/compute-dashboard/jobs?select=57483355-abcd",
  )
  assert.equal(
    getSessionResourceHref("session", "79ebd27e-abcd"),
    "/apps/codered/sessions/79ebd27e-abcd",
  )
  assert.equal(
    getSessionResourceHref("discussion", "bf52db9e-abcd"),
    "/apps/nova/chat/bf52db9e-abcd",
  )
})

test("session resource ids are encoded before entering a URL", () => {
  assert.equal(
    getSessionResourceHref("discussion", "id/with spaces"),
    "/apps/nova/chat/id%2Fwith%20spaces",
  )
})
