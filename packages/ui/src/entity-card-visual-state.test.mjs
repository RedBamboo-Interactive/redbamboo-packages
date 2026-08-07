import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const source = readFileSync(new URL("./components/entity-card.tsx", import.meta.url), "utf8")

test("outlined entity-card interaction states keep a neutral border", () => {
  assert.doesNotMatch(source, /border-primary\/40/)
  assert.doesNotMatch(source, /hover:border-primary\/30/)
  assert.match(source, /active && variant === "outlined" && "bg-overlay-6"/)
  assert.match(source, /hover:border-overlay-10 hover:bg-overlay-4/)
})
