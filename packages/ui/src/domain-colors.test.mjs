import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"
import { DOMAIN_COLORS } from "./domain-colors.ts"

const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")

test("domain color constants stay aligned with the CSS design tokens", () => {
  for (const [domain, hex] of Object.entries(DOMAIN_COLORS)) {
    assert.match(tokens, new RegExp(`--color-domain-${domain}:\\s*${hex};`))
  }
})

test("live status keeps its brighter positive pink", () => {
  assert.match(tokens, /--color-status-live:\s*#EC4899;/)
})
