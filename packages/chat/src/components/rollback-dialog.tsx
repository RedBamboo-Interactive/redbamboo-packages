import { useEffect, useState } from "react"
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@redbamboo/ui"

/**
 * The one confirmation for a rewind. The person chose it explicitly, so it can ask plainly: what
 * goes, what comes back, and that the files stay as they are.
 */
export function RollbackDialog({
  messageUid,
  onConfirm,
  onClose,
}: {
  messageUid: string | null
  /** Rejects with the server's own words when it refuses. */
  onConfirm: (messageUid: string) => Promise<void>
  onClose: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setBusy(false)
    setError(null)
  }, [messageUid])

  const confirm = async () => {
    if (!messageUid || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(messageUid)
      onClose()
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : "The rewind failed.")
      setBusy(false)
    }
  }

  return (
    <Dialog open={messageUid !== null} onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-w-sm p-0 gap-0" data-chat-rollback-dialog="">
        <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
          <i aria-hidden="true" className="ph-bold ph-arrow-counter-clockwise text-sm text-text-muted" />
          <DialogTitle className="text-sm">Rewind to before this message?</DialogTitle>
        </DialogHeader>
        <div className="p-4 space-y-2 text-sm">
          <p>This message and everything after it leave the conversation, for you and for the agent.</p>
          <p>Your message comes back to the composer, without its attachments.</p>
          <p className="font-medium">Files are not changed. Anything the agent already did on disk stays as it is.</p>
          {error && <p role="alert" className="text-destructive">{error}</p>}
        </div>
        <DialogFooter className="px-4 py-3 border-t border-border-subtle">
          <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => { void confirm() }} disabled={busy}>
            {busy && <i aria-hidden="true" className="ph-bold ph-spinner animate-spin" />}
            Rewind
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
