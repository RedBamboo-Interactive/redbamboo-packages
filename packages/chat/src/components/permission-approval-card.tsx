import { useEffect, useState } from "react"
import { Button, cn } from "@redbamboo/ui"
import type { PermissionApproval, PermissionDecision, PermissionOutcome } from "../types"
import { PERMISSION_DECISIONS } from "../lib/permission-approval"

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
export function PermissionApprovalCard({ approval, onDecide, className }: {
  approval: PermissionApproval
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

  const summary = request.summary && request.summary !== request.toolName ? request.summary : null

  if (outcome) {
    const { icon, tone, label } = OUTCOME_COPY[outcome]
    return (
      <div
        data-slot="permission-approval-card"
        data-outcome={outcome}
        data-tool-use-id={request.toolUseId ?? undefined}
        className={cn("my-1.5 flex w-full max-w-xl min-w-0 items-center gap-2 rounded-md border border-overlay-10 bg-overlay-4 px-3 py-1.5 text-xs", className)}
      >
        <i aria-hidden="true" className={`ph-bold ${icon} shrink-0 ${tone}`} />
        <span className="shrink-0 font-medium text-text-secondary">{label}</span>
        <span aria-hidden="true" className="shrink-0 text-text-muted">·</span>
        <span className="shrink-0 font-mono text-text-muted">{request.toolName}</span>
        {summary && <code className="min-w-0 truncate font-mono text-text-muted" title={summary}>{summary}</code>}
      </div>
    )
  }

  const options = request.options?.length ? request.options : PERMISSION_DECISIONS
  return (
    <div
      role="group"
      aria-label={`Approval for ${request.toolName}`}
      data-slot="permission-approval-card"
      data-outcome="pending"
      data-tool-use-id={request.toolUseId ?? undefined}
      className={cn("my-2 w-full max-w-xl min-w-0 rounded-md border border-amber-400/40 bg-amber-400/[0.06] px-3 py-2.5", className)}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-xs">
        <i aria-hidden="true" className="ph-bold ph-shield-warning shrink-0 text-amber-400 animate-pulse" />
        <span className="shrink-0 font-medium text-amber-300">Waiting for your approval</span>
        <span aria-hidden="true" className="shrink-0 text-text-muted">·</span>
        <span className="min-w-0 truncate font-mono text-text-muted">{request.toolName}</span>
      </div>
      {summary && (
        <pre
          data-slot="permission-approval-summary"
          className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-overlay-6 px-2 py-1.5 font-mono text-xs text-text-primary"
        >{summary}</pre>
      )}
      {request.cwd && (
        <div className="mt-1 truncate font-mono text-[10px] text-text-muted" title={request.cwd}>in {request.cwd}</div>
      )}
      {onDecide && (
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
      {error && <p role="alert" className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  )
}
