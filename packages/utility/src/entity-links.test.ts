import assert from "node:assert/strict"
import { test } from "node:test"
import { getEntityHref } from "./entity-links.ts"

test("getEntityHref builds a canonical entity route", () => {
  assert.equal(getEntityHref("agent", "abc-123"), "/database/entities/agent/abc-123")
})

test("getEntityHref encodes route segments", () => {
  assert.equal(
    getEntityHref("custom type", "entity/with/slashes"),
    "/database/entities/custom%20type/entity%2Fwith%2Fslashes",
  )
})
