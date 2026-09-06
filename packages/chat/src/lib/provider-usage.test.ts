import assert from "node:assert/strict"
import test from "node:test"
import type { ProviderUsageSnapshot } from "../types.ts"
import {
  claimProviderUsageAlerts,
  formatProviderUsageWindow,
  remainingProviderUsage,
} from "./provider-usage.ts"

function snapshot(usedPercent: number, resetsAt = "2026-09-07T02:25:33Z"): ProviderUsageSnapshot {
  return {
    provider: "test-provider",
    displayName: "Test Provider",
    planType: "pro",
    fetchedAt: "2026-09-05T14:00:00Z",
    resetCreditsAvailable: 3,
    buckets: [{
      id: "main",
      name: "Main quota",
      windows: [{ id: "primary", usedPercent, windowDurationMinutes: 10080, resetsAt }],
    }],
  }
}

function storage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

test("claims one 90% warning per concrete quota window", () => {
  const store = storage()
  assert.equal(claimProviderUsageAlerts(snapshot(89.9), store).length, 0)
  assert.equal(claimProviderUsageAlerts(snapshot(90), store)[0]?.threshold, 90)
  assert.equal(claimProviderUsageAlerts(snapshot(96), store).length, 0)
})

test("100% wins when the first observation is already exhausted", () => {
  const store = storage()
  const reset = "2026-09-08T02:25:33Z"
  const alert = claimProviderUsageAlerts(snapshot(100, reset), store)
  assert.deepEqual(alert.map(item => item.threshold), [100])
  assert.equal(claimProviderUsageAlerts(snapshot(95, reset), store).length, 0)
})

test("a new reset timestamp creates a new alertable quota window", () => {
  const store = storage()
  assert.equal(claimProviderUsageAlerts(snapshot(90, "2026-09-09T02:25:33Z"), store).length, 1)
  assert.equal(claimProviderUsageAlerts(snapshot(90, "2026-09-10T02:25:33Z"), store).length, 1)
})

test("formats quota windows and remaining capacity", () => {
  assert.equal(formatProviderUsageWindow(300), "5 hours")
  assert.equal(formatProviderUsageWindow(10080), "Weekly")
  assert.equal(remainingProviderUsage({ id: "x", usedPercent: 92.4, windowDurationMinutes: 300 }), 7.6)
})
