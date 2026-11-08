import assert from "node:assert/strict"
import test from "node:test"

import { formatProviderEffort } from "./provider-effort.ts"

test("formats provider-native effort values for session metadata", () => {
  assert.equal(formatProviderEffort("high"), "High")
  assert.equal(formatProviderEffort("xhigh"), "XHigh")
  assert.equal(formatProviderEffort("ultra"), "Ultra")
})

test("preserves unknown provider effort values without inventing a meaning", () => {
  assert.equal(formatProviderEffort("adaptive-v2"), "Adaptive-v2")
  assert.equal(formatProviderEffort("CustomMode"), "CustomMode")
  assert.equal(formatProviderEffort("  provider_native  "), "Provider_native")
})

test("returns no presentation value for missing or empty effort", () => {
  assert.equal(formatProviderEffort(), null)
  assert.equal(formatProviderEffort(null), null)
  assert.equal(formatProviderEffort(""), null)
  assert.equal(formatProviderEffort("   "), null)
})
