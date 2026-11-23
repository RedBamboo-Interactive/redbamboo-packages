import assert from "node:assert/strict"
import test from "node:test"
import { formatModelName } from "./model-name.ts"

test("model names: family and dotted version", () => {
  assert.equal(formatModelName("claude-opus-5-5"), "Opus 5.5")
  assert.equal(formatModelName("claude-sonnet-5-5"), "Sonnet 5.5")
  assert.equal(formatModelName("claude-haiku-4-5-20251001"), "Haiku 4.5")
  assert.equal(formatModelName("claude-opus-4"), "Opus 4")
  assert.equal(formatModelName("Claude-Fable-5-2"), "Fable 5.2")
})

test("model names: unknown ids pass through unchanged", () => {
  assert.equal(formatModelName("gpt-5.1-codex"), "gpt-5.1-codex")
  assert.equal(formatModelName("gemma3:27b"), "gemma3:27b")
  assert.equal(formatModelName("claude-opus"), "claude-opus")
  assert.equal(formatModelName(null), "")
  assert.equal(formatModelName(""), "")
})
