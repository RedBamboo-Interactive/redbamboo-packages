import assert from "node:assert/strict"
import { test } from "node:test"
import { formatPromptCacheCounts } from "./session-info-usage.ts"

test("formats provider usage with the exact token counts", () => {
  const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 })
  const cached = 7_606_144
  const input = 7_797_030
  assert.equal(
    formatPromptCacheCounts({ cachedInputTokens: cached, inputTokens: input }),
    `${percent.format(0.976)} · ${cached.toLocaleString()} / ${input.toLocaleString()} tokens`,
  )
})

test("distinguishes a measured miss, a tiny positive rate and unavailable counts", () => {
  const percent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 })
  assert.equal(formatPromptCacheCounts({ cachedInputTokens: 0, inputTokens: 100 }), `${percent.format(0)} · 0 / 100 tokens`)
  assert.match(formatPromptCacheCounts({ cachedInputTokens: 1, inputTokens: 10_000 })!, /^</)
  assert.equal(formatPromptCacheCounts(undefined), null)
  assert.equal(formatPromptCacheCounts({ cachedInputTokens: 0, inputTokens: 0 }), null)
  assert.equal(formatPromptCacheCounts({ cachedInputTokens: 101, inputTokens: 100 }), null)
})
