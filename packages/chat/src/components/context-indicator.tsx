import { useCallback, useEffect, useRef, useState } from "react"
import { useToast } from "@redbamboo/ui"
import type { SessionInfoButtonProps } from "../types"
import type { ProviderUsageSnapshot } from "../types"
import { claimProviderUsageAlerts } from "../lib/provider-usage"
import { SessionStatsModal } from "./session-stats-modal"

function alertStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try { return window.localStorage } catch { return null }
}

function formatResetForToast(value?: string | null): string | undefined {
  if (!value) return undefined
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return undefined
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date)
}

export function SessionInfoButton({ stats, messages, agent, modelOptions, effortOptions, qualityTierOptions, providerOptions, loadProviderUsage, onConfigChange, children }: SessionInfoButtonProps) {
  const [open, setOpen] = useState(false)
  const [providerUsage, setProviderUsage] = useState<ProviderUsageSnapshot | null>(null)
  const [providerUsageLoading, setProviderUsageLoading] = useState(false)
  const providerUsageRequest = useRef(0)
  const { toast } = useToast()
  const providerId = stats?.provider ?? stats?.providerEntity

  const refreshProviderUsage = useCallback(async (forceRefresh = false) => {
    const request = ++providerUsageRequest.current
    if (!loadProviderUsage || !providerId) {
      setProviderUsage(null)
      setProviderUsageLoading(false)
      return
    }
    setProviderUsageLoading(true)
    try {
      const usage = await loadProviderUsage(providerId, forceRefresh)
      if (request !== providerUsageRequest.current) return
      setProviderUsage(usage)
      if (!usage) return

      for (const alert of claimProviderUsageAlerts(usage, alertStorage())) {
        const reset = formatResetForToast(alert.resetsAt)
        const remaining = Math.max(0, Math.round((100 - alert.usedPercent) * 10) / 10)
        toast(alert.threshold === 100
          ? {
              title: `${alert.provider} usage limit reached`,
              description: `${alert.bucket} · ${alert.windowLabel}${reset ? ` · resets ${reset}` : ""}`,
              variant: "error",
            }
          : {
              title: `${alert.provider} usage at ${Math.round(alert.usedPercent)}%`,
              description: `${remaining}% left in ${alert.bucket} · ${alert.windowLabel}${reset ? ` · resets ${reset}` : ""}`,
              variant: "default",
            })
      }
    } catch {
      // Provider usage is optional. A provider/account lookup failure must never disturb chat.
      if (request === providerUsageRequest.current) setProviderUsage(null)
    } finally {
      if (request === providerUsageRequest.current) setProviderUsageLoading(false)
    }
  }, [loadProviderUsage, providerId, toast])

  useEffect(() => {
    void refreshProviderUsage(false)
  }, [refreshProviderUsage, stats?.sessionId, stats?.status, stats?.messageCount, stats?.outputTokens])

  useEffect(() => {
    if (open) void refreshProviderUsage(true)
  }, [open, refreshProviderUsage])

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-md px-2 text-xs font-medium text-text-muted transition-colors hover:bg-overlay-10 hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-a50"
        title="Session info"
        aria-label="Open session info"
        aria-haspopup="dialog"
        aria-expanded={open}
        data-slot="session-info-trigger"
      >
        <i aria-hidden="true" className="ph-bold ph-info text-sm" />
        <span>Info</span>
      </button>

      <SessionStatsModal
        open={open}
        onOpenChange={setOpen}
        stats={stats}
        messages={messages}
        agent={agent}
        modelOptions={modelOptions}
        effortOptions={effortOptions}
        qualityTierOptions={qualityTierOptions}
        providerOptions={providerOptions}
        providerUsage={providerUsage}
        providerUsageLoading={providerUsageLoading}
        onConfigChange={onConfigChange}
      >
        {children}
      </SessionStatsModal>
    </>
  )
}

/** @deprecated Use SessionInfoButton. */
export const ContextIndicator = SessionInfoButton
