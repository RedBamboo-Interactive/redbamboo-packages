import {
  Loader2,
  CheckCircle,
  XCircle,
  GitMerge,
  Ban,
  ExternalLink,
  Check,
  X,
  RotateCcw,
} from "lucide-react"
import { Badge, Button } from "@redbamboo/ui"
import type { TackleRun } from "../types"
import { tackleStatusIcon, timeAgo } from "../components/shared"

interface Props {
  open: boolean
  tackle: TackleRun | null
  onClose: () => void
  onApprove?: (tackle: TackleRun) => void
  onMerge?: (tackle: TackleRun) => void
  onDismiss?: (tackle: TackleRun) => void
  onRetackle?: (tackle: TackleRun) => void
}

export function TackleDetailModal({
  open,
  tackle,
  onClose,
  onApprove,
  onMerge,
  onDismiss,
  onRetackle,
}: Props) {
  if (!open || !tackle) return null

  const isPending = tackle.status === "pending" || tackle.status === "running"
  const canApprove =
    tackle.status === "awaiting_review" && tackle.ai_approved && !tackle.human_approved
  const canMerge = tackle.status === "awaiting_merge"

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border flex-none">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-medium">Tackle</h2>
            {tackle.issue_number && (
              <Badge variant="outline" className="text-[10px]">
                #{tackle.issue_number}
              </Badge>
            )}
            {tackleStatusIcon(tackle.status)}
            <span className="text-xs capitalize text-text-muted">
              {tackle.status.replace(/_/g, " ")}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-contrast text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-4">
          {/* Issue info */}
          <div className="text-sm">
            <p className="font-medium">{tackle.issue_title}</p>
            <p className="text-xs text-text-muted mt-1">
              {tackle.mode} &middot; started {timeAgo(tackle.started_at)}
              {tackle.model && (
                <Badge variant="outline" className="ml-2 text-[9px] text-amber-400">
                  {tackle.model}
                </Badge>
              )}
            </p>
          </div>

          {/* Branch & PR */}
          {tackle.branch_name && (
            <div className="bg-overlay-5 rounded-md p-3 text-sm space-y-1">
              <p>
                <span className="text-text-muted">Branch:</span>{" "}
                <code className="text-xs">{tackle.branch_name}</code>
              </p>
              {tackle.pull_request_url && (
                <p className="flex items-center gap-1">
                  <span className="text-text-muted">PR:</span>
                  <a
                    href={tackle.pull_request_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs underline flex items-center gap-1"
                  >
                    #{tackle.pull_request_number} <ExternalLink className="size-3" />
                  </a>
                </p>
              )}
              {tackle.commit_hash && (
                <p>
                  <span className="text-text-muted">Commit:</span>{" "}
                  <code className="text-xs">{tackle.commit_hash.slice(0, 7)}</code>
                </p>
              )}
            </div>
          )}

          {/* Approval state */}
          <div className="flex gap-4 text-sm">
            <div className="flex items-center gap-1.5">
              {tackle.ai_approved ? (
                <CheckCircle className="size-4 text-emerald-400" />
              ) : (
                <XCircle className="size-4 text-text-muted opacity-30" />
              )}
              <span>AI Review</span>
            </div>
            <div className="flex items-center gap-1.5">
              {tackle.human_approved ? (
                <CheckCircle className="size-4 text-emerald-400" />
              ) : (
                <XCircle className="size-4 text-text-muted opacity-30" />
              )}
              <span>Human Approval</span>
            </div>
          </div>

          {/* Error */}
          {tackle.error_message && (
            <div className="bg-red-500/10 text-red-400 rounded-md p-3 text-sm">
              {tackle.error_message}
            </div>
          )}

          {/* Pending spinner */}
          {isPending && (
            <div className="flex flex-col items-center justify-center py-6 text-text-muted">
              <Loader2 className="size-8 animate-spin mb-3" />
              <p className="text-sm">
                {tackle.status === "pending"
                  ? "Queued..."
                  : "Claude is implementing the fix..."}
              </p>
            </div>
          )}

          {tackle.status === "merging" && (
            <div className="flex flex-col items-center justify-center py-6 text-text-muted">
              <Loader2 className="size-8 animate-spin mb-3" />
              <p className="text-sm">Merging...</p>
            </div>
          )}

          {tackle.status === "merged" && (
            <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 rounded-md p-3 text-sm">
              <GitMerge className="size-4" />
              Merged successfully
            </div>
          )}

          {tackle.status === "dismissed" && (
            <div className="flex items-center gap-2 text-text-muted bg-overlay-5 rounded-md p-3 text-sm">
              <Ban className="size-4" />
              Dismissed
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border flex-none">
          {canApprove && onApprove && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onApprove(tackle)}
              className="text-emerald-400"
            >
              <Check className="size-3.5 mr-1" />
              Approve
            </Button>
          )}
          {canMerge && onMerge && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onMerge(tackle)}
              className="text-emerald-400"
            >
              <GitMerge className="size-3.5 mr-1" />
              Merge
            </Button>
          )}
          {tackle.status === "dismissed" && onRetackle && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onRetackle(tackle)}
            >
              <RotateCcw className="size-3.5 mr-1" />
              Re-tackle
            </Button>
          )}
          {!isPending &&
            tackle.status !== "merged" &&
            tackle.status !== "merging" &&
            tackle.status !== "dismissed" &&
            onDismiss && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => onDismiss(tackle)}
                className="text-text-muted"
              >
                <X className="size-3.5 mr-1" />
                Dismiss
              </Button>
            )}
          <Button variant="ghost" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  )
}
