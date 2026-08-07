import assert from "node:assert/strict"
import { test } from "node:test"
import {
  getEntityEmbedHref,
  getEntityHref,
  parseEntityEmbedHref,
  parseEntityHref,
} from "./entity-links.ts"

test("getEntityHref builds a canonical entity route", () => {
  assert.equal(getEntityHref("agent", "abc-123"), "/database/entities/agent/abc-123")
})

test("getEntityHref encodes route segments", () => {
  assert.equal(
    getEntityHref("custom type", "entity/with/slashes"),
    "/database/entities/custom%20type/entity%2Fwith%2Fslashes",
  )
})

test("getEntityEmbedHref builds the established Page embed targets", () => {
  assert.equal(
    getEntityEmbedHref("quality-mode", "abc-123"),
    "redleaf://quality-mode/abc-123",
  )
  assert.equal(
    getEntityEmbedHref("quality-mode", "abc-123", { display: "preview" }),
    "redleaf://quality-mode/abc-123?display=preview",
  )
  assert.equal(
    getEntityEmbedHref("quality-mode", "abc-123", { field: "reasoning_effort" }),
    "redleaf://quality-mode/abc-123?field=reasoning_effort",
  )
})

test("parseEntityEmbedHref reads card, preview, inline, and field embeds", () => {
  assert.deepEqual(parseEntityEmbedHref("redleaf://quality-mode/abc-123"), {
    typeSlug: "quality-mode",
    entityId: "abc-123",
    display: "card",
  })
  assert.deepEqual(parseEntityEmbedHref("redleaf://quality-mode/abc-123?display=preview"), {
    typeSlug: "quality-mode",
    entityId: "abc-123",
    display: "preview",
  })
  assert.deepEqual(parseEntityEmbedHref("redleaf://quality-mode/abc-123?display=inline"), {
    typeSlug: "quality-mode",
    entityId: "abc-123",
    display: "inline",
  })
  assert.deepEqual(parseEntityEmbedHref("redleaf://quality-mode/abc-123?field=reasoning_effort"), {
    typeSlug: "quality-mode",
    entityId: "abc-123",
    display: "field",
    field: "reasoning_effort",
  })
})

test("entity embed hrefs encode identity segments and reject malformed targets", () => {
  const encoded = getEntityEmbedHref("custom type", "entity/with/slashes")
  assert.equal(encoded, "redleaf://custom%20type/entity%2Fwith%2Fslashes")
  assert.deepEqual(parseEntityEmbedHref(encoded), {
    typeSlug: "custom type",
    entityId: "entity/with/slashes",
    display: "card",
  })
  assert.equal(parseEntityEmbedHref("redleaf://quality-mode"), null)
  assert.equal(parseEntityEmbedHref("https://leaf.example/quality-mode/abc-123"), null)
  assert.equal(parseEntityEmbedHref("redleaf://quality-mode/abc-123#fragment"), null)
})

test("parseEntityHref reads relative canonical routes", () => {
  assert.deepEqual(
    parseEntityHref("/database/entities/quality-mode/2795e49f-4087-e052-be15-7973309836f2"),
    {
      typeSlug: "quality-mode",
      entityId: "2795e49f-4087-e052-be15-7973309836f2",
    },
  )
})

test("parseEntityHref decodes canonical route segments", () => {
  assert.deepEqual(
    parseEntityHref("/database/entities/custom%20type/entity%2Fwith%2Fslashes"),
    { typeSlug: "custom type", entityId: "entity/with/slashes" },
  )
})

test("parseEntityHref accepts same-origin absolute routes", () => {
  assert.deepEqual(
    parseEntityHref(
      "https://leaf.example/database/entities/agent/abc-123",
      "https://leaf.example",
    ),
    { typeSlug: "agent", entityId: "abc-123" },
  )
})

test("parseEntityHref rejects cross-origin and decorated routes", () => {
  assert.equal(
    parseEntityHref(
      "https://other.example/database/entities/agent/abc-123",
      "https://leaf.example",
    ),
    null,
  )
  assert.equal(parseEntityHref("//other.example/database/entities/agent/abc-123"), null)
  assert.equal(parseEntityHref("/database/entities/agent/abc-123?view=raw"), null)
  assert.equal(parseEntityHref("/database/entities/agent/abc-123#details"), null)
  assert.equal(parseEntityHref("/database/entities/agent"), null)
})
