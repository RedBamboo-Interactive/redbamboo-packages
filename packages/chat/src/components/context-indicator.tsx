import { useState } from "react"
import type { SessionInfoButtonProps } from "../types"
import { SessionStatsModal } from "./session-stats-modal"

export function SessionInfoButton({ stats, messages, agent, modelOptions, effortOptions, qualityTierOptions, providerOptions, onConfigChange, children }: SessionInfoButtonProps) {
  const [open, setOpen] = useState(false)

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
        onConfigChange={onConfigChange}
      >
        {children}
      </SessionStatsModal>
    </>
  )
}

/** @deprecated Use SessionInfoButton. */
export const ContextIndicator = SessionInfoButton
