import { useEffect, useState } from "react"
import { Button, cn } from "@redbamboo/ui"
import type { PermissionApproval, PermissionDecision, PermissionOutcome } from "../types"
import { PERMISSION_DECISIONS, permissionApprovalPresentation } from "../lib/permission-approval"

const DECISION_LABELS: Record<PermissionDecision, string> = {
  allow_once: "Allow once",
  allow_session: "Allow for this session",
  deny: "Deny",
}

const OUTCOME_COPY: Record<PermissionOutcome, { icon: string; tone: string; label: string }> = {
  allow_once: { icon: "ph-check", tone: "text-green-400", label: "Allowed once" },
  allow_session: { icon: "ph-checks", tone: "text-green-400", label: "Allowed for this session" },
  deny: { icon: "ph-prohibit", tone: "text-red-400", label: "Denied" },
  answered: { icon: "ph-check", tone: "text-text-muted", label: "Answered" },
  timeout: { icon: "ph-clock-countdown", tone: "text-amber-400", label: "Denied: no answer in time" },
  cancelled: { icon: "ph-x", tone: "text-amber-400", label: "Cancelled before an answer" },
  session_ended: { icon: "ph-plugs", tone: "text-amber-400", label: "Session ended before an answer" },
  unresolved: { icon: "ph-warning", tone: "text-amber-400", label: "No answer reached the agent" },
}

/**
 * Approval for one tool call, drawn on that call. Waiting, it offers the
 * request's decisions; settled, it says how it ended. A refused decision keeps
 * the buttons and shows the refusal in its own words.
 */
export function PermissionApprovalCard({ approval, toolInput, onDecide, className }: {
  approval: PermissionApproval
  /** Input on this approval's matching tool call, if it arrived separately. */
  toolInput?: string
  /** Absent: the card waits without buttons (this surface can't decide). */
  onDecide?: (decision: PermissionDecision) => void | Promise<void>
  className?: string
}) {
  const { request, outcome } = approval
  const [sending, setSending] = useState<PermissionDecision | null>(null)
  const [error, setError] = useState<string | null>(null)
  // A new request on the same tool call starts clean.
  useEffect(() => { setSending(null); setError(null) }, [approval.requestId])

  const decide = async (decision: PermissionDecision) => {
    if (!onDecide || sending) return
    setSending(decision)
    setError(null)
    try {
      await onDecide(decision)
    } catch (failure) {
      setSending(null)
      setError(failure instanceof Error && failure.message ? failure.message : "The decision didn't reach the agent.")
    }
  }

  const view = permissionApprovalPresentation(request, toolInput)
  const status = outcome ? OUTCOME_COPY[outcome] : {
    icon: "ph-shield-warning", tone: "text-amber-400 animate-pulse", label: "Waiting for your approval",
  }
  const options = request.options?.length ? request.options : PERMISSION_DECISIONS
  return (
    <div
      role={outcome ? undefined : "group"}
      aria-label={outcome ? undefined : `Approval for ${request.toolName}`}
      data-slot="permission-approval-card"
      data-outcome={outcome ?? "pending"}
      data-tool-use-id={request.toolUseId ?? undefined}
      className={cn("w-full max-w-xl min-w-0 rounded-md border px-3 text-xs",
        outcome ? "my-1.5 border-overlay-10 bg-overlay-4 py-1.5" : "my-2 border-amber-400/40 bg-amber-400/[0.06] py-2.5",
        className)}
    >
      <div className="flex min-w-0 items-center gap-1.5">
        <i aria-hidden="true" className={cn("ph-bold shrink-0", status.icon, status.tone)} />
        <span className={cn("font-medium", outcome ? "text-muted-foreground" : "text-amber-300")}>{status.label}</span>
      </div>
      {view.encoded && (
        <p data-slot="permission-encoded-warning" className="mt-1 font-semibold text-amber-300">
          Command contains encoded content
        </p>
      )}
      <p data-slot="permission-approval-summary" className="mt-1 break-words text-text-primary">
        {view.description ? <>Agent description: {view.description}</> : view.fallback}
      </p>
      {view.missingCommand && <p className="mt-1 text-text-muted">Full command unavailable.</p>}
      {(view.action || request.cwd) && (
        <details key={approval.requestId} className="mt-1 text-text-muted">
          <summary className="cursor-pointer">{view.action ? view.detailLabel : "Show working directory"}</summary>
          {view.action && (
            <pre data-slot="permission-approval-action"
              className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-overlay-6 px-2 py-1.5 font-mono text-text-primary"
            >{view.action}</pre>
          )}
          {request.cwd && <p className="mt-1 break-all font-mono">Working directory: {request.cwd}</p>}
        </details>
      )}
      {!outcome && onDecide && (
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {options.map(decision => (
            <Button
              key={decision}
              type="button"
              size="sm"
              variant={decision === "deny" ? "outline" : decision === "allow_once" ? "default" : "secondary"}
              disabled={!!sending}
              onClick={() => void decide(decision)}
              data-decision={decision}
            >
              {sending === decision && <i aria-hidden="true" className="ph-bold ph-circle-notch animate-spin text-xs" />}
              {DECISION_LABELS[decision]}
            </Button>
          ))}
        </div>
      )}
      {!outcome && error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
