import { useState, useCallback } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@redbamboo/ui"

export interface ShareDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  shareUrl: string | null
  loading: boolean
  error: string | null
  title?: string
  description?: string
}

export function ShareDialog({ open, onOpenChange, shareUrl, loading, error, title = "Share conversation", description = "Anyone with this link can view a read-only snapshot of this conversation." }: ShareDialogProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    if (!shareUrl) return
    await navigator.clipboard.writeText(shareUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }, [shareUrl])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0">
        <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
          <i className="ph-bold ph-share-network text-sm text-text-muted" />
          <DialogTitle className="text-sm">{title}</DialogTitle>
        </DialogHeader>

        <div className="p-4 space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-sm text-text-muted py-4 justify-center">
              <i className="ph-bold ph-spinner animate-spin" />
              <span>Creating share link…</span>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded-md px-3 py-2">
              {error}
            </div>
          )}

          {shareUrl && !loading && (
            <>
              <p className="text-xs text-text-muted">
                {description}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  className="flex-1 text-xs bg-overlay-6 border border-overlay-10 rounded-md px-3 py-2 text-text-secondary font-mono select-all outline-none focus:border-accent-primary/50"
                  onFocus={(e) => e.target.select()}
                />
                <button
                  onClick={handleCopy}
                  className="shrink-0 flex items-center gap-1.5 text-xs px-3 py-2 rounded-md bg-accent-primary/15 text-accent-primary hover:bg-accent-primary/25 transition-colors"
                >
                  <i className={`ph-bold ${copied ? "ph-check" : "ph-copy"} text-sm`} />
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
