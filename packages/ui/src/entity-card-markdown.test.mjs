import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")

test("markdown link typography excludes semantic EntityCard anchors", () => {
  const selector = '.markdown-body a:not([data-slot="entity-card-primary"]):not([data-slot="entity-card-open"])'
  assert.equal(tokens.split(selector).length - 1, 2)
  assert.doesNotMatch(tokens, /\.markdown-body a\s*\{/)
})
