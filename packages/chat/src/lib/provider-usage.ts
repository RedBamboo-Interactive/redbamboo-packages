import type { ProviderUsageSnapshot, ProviderUsageWindow } from "../types"

export const PROVIDER_USAGE_ALERTS_STORAGE_KEY = "redbamboo:chat:provider-usage-alerts:v1"

export interface ProviderUsageThresholdAlert {
  key: string
  threshold: 90 | 100
  usedPercent: number
  provider: string
  bucket: string
  windowLabel: string
  resetsAt?: string | null
}

const inMemoryClaims = new Set<string>()

export function formatProviderUsageWindow(minutes: number): string {
  if (minutes === 60 * 24) return "Daily"
  if (minutes === 60 * 24 * 7) return "Weekly"
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)} days`
  if (minutes % 60 === 0) return `${minutes / 60} hours`
  return `${minutes} minutes`
}

export function remainingProviderUsage(window: ProviderUsageWindow): number {
  return Math.max(0, Math.round((100 - window.usedPercent) * 10) / 10)
}

export function claimProviderUsageAlerts(
  snapshot: ProviderUsageSnapshot,
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): ProviderUsageThresholdAlert[] {
  const persisted = readPersistedClaims(storage)
  const alerts: ProviderUsageThresholdAlert[] = []

  for (const bucket of snapshot.buckets) {
    for (const window of bucket.windows) {
      const threshold: 90 | 100 | null = window.usedPercent >= 100
        ? 100
        : window.usedPercent >= 90
          ? 90
          : null
      if (threshold === null) continue

      const key = [
        snapshot.provider,
        bucket.id,
        window.id,
        window.resetsAt ?? "unknown-reset",
        threshold,
      ].join(":")
      if (persisted.has(key) || inMemoryClaims.has(key)) continue

      if (threshold === 100) {
        const warningKey = [
          snapshot.provider,
          bucket.id,
          window.id,
          window.resetsAt ?? "unknown-reset",
          90,
        ].join(":")
        persisted.add(warningKey)
        inMemoryClaims.add(warningKey)
      }
      persisted.add(key)
      inMemoryClaims.add(key)
      alerts.push({
        key,
        threshold,
        usedPercent: window.usedPercent,
        provider: snapshot.displayName || snapshot.provider,
        bucket: bucket.name,
        windowLabel: formatProviderUsageWindow(window.windowDurationMinutes),
        resetsAt: window.resetsAt,
      })
    }
  }

  writePersistedClaims(storage, persisted)
  return alerts
}

function readPersistedClaims(storage?: Pick<Storage, "getItem" | "setItem"> | null): Set<string> {
  if (!storage) return new Set(inMemoryClaims)
  try {
    const raw = storage.getItem(PROVIDER_USAGE_ALERTS_STORAGE_KEY)
    if (!raw) return new Set(inMemoryClaims)
    const parsed = JSON.parse(raw)
    return new Set([
      ...inMemoryClaims,
      ...(Array.isArray(parsed) ? parsed.filter(value => typeof value === "string") : []),
    ])
  } catch {
    return new Set(inMemoryClaims)
  }
}

function writePersistedClaims(
  storage: Pick<Storage, "getItem" | "setItem"> | null | undefined,
  claims: Set<string>,
) {
  if (!storage) return
  try {
    storage.setItem(PROVIDER_USAGE_ALERTS_STORAGE_KEY, JSON.stringify([...claims].slice(-200)))
  } catch {
    // Storage can be unavailable in private or embedded browser contexts. The module-level set
    // still prevents repeated alerts within this loaded client.
  }
}
