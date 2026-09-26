import assert from "node:assert/strict"
import test from "node:test"
import { humanizeJsonKey, isImageJsonField, isTechnicalJsonKey, parseStructuredJson } from "./structured-data.ts"

test("humanizes camel-case and preserves familiar acronyms", () => {
  assert.equal(humanizeJsonKey("gameMasterPlan"), "Game master plan")
  assert.equal(humanizeJsonKey("sourceMessageUid"), "Source message UID")
  assert.equal(humanizeJsonKey("imageURL"), "Image URL")
  assert.equal(humanizeJsonKey("world_notes"), "World notes")
})

test("separates technical receipt keys from story fields", () => {
  assert.equal(isTechnicalJsonKey("id"), true)
  assert.equal(isTechnicalJsonKey("imageJobId"), true)
  assert.equal(isTechnicalJsonKey("sourceMessageUid"), true)
  assert.equal(isTechnicalJsonKey("updatedAt"), true)
  assert.equal(isTechnicalJsonKey("imageStatus"), false)
  assert.equal(isTechnicalJsonKey("gameMasterPlan"), false)
})

test("recognizes actual image fields without treating asset ids as images", () => {
  assert.equal(isImageJsonField("imageUrl", "/api/assets/example.png"), true)
  assert.equal(isImageJsonField("avatar_src", "https://example.test/a.webp"), true)
  assert.equal(isImageJsonField("imageAssetId", "stable-example.png"), false)
  assert.equal(isImageJsonField("prompt", "/api/assets/example.png"), false)
})

test("parses structured JSON and rejects malformed input", () => {
  assert.deepEqual(parseStructuredJson('{"name":"Omnipotent","ready":true}'), { name: "Omnipotent", ready: true })
  assert.equal(parseStructuredJson('{"name":'), undefined)
})
