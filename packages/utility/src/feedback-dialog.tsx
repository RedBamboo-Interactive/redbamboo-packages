import * as React from "react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
} from "@redbamboo/ui"
import type { FeedbackContext, FeedbackSubmission, SystemInfo } from "./feedback-types"

export interface FeedbackDialogProps {
  app: { name: string; version: string }
  customMetadata?: Record<string, string>
  onSubmit: (submission: FeedbackSubmission) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

function parseBrowser(ua: string): string {
  if (ua.includes("Firefox/")) return `Firefox ${ua.match(/Firefox\/([\d.]+)/)?.[1] ?? ""}`
  if (ua.includes("Edg/")) return `Edge ${ua.match(/Edg\/([\d.]+)/)?.[1] ?? ""}`
  if (ua.includes("Chrome/")) return `Chrome ${ua.match(/Chrome\/([\d.]+)/)?.[1] ?? ""}`
  if (ua.includes("Safari/") && !ua.includes("Chrome")) {
    return `Safari ${ua.match(/Version\/([\d.]+)/)?.[1] ?? ""}`
  }
  return ua.slice(0, 50)
}

function parseOS(ua: string): string {
  if (ua.includes("Windows NT 10.0")) return "Windows 10/11"
  if (ua.includes("Windows NT")) return "Windows"
  if (ua.includes("Mac OS X")) {
    return `macOS ${ua.match(/Mac OS X ([\d_]+)/)?.[1]?.replace(/_/g, ".") ?? ""}`
  }
  if (ua.includes("Linux")) return "Linux"
  if (ua.includes("Android")) return "Android"
  if (ua.includes("iOS") || ua.includes("iPhone")) return "iOS"
  return "Unknown"
}

export function collectSystemInfo(app: { name: string; version: string }): SystemInfo {
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown"
  return {
    appName: app.name,
    appVersion: app.version,
    browser: parseBrowser(ua),
    os: parseOS(ua),
    screenResolution: typeof screen !== "undefined" ? `${screen.width}x${screen.height}` : "unknown",
    currentUrl: typeof location !== "undefined" ? `${location.origin}${location.pathname}` : "unknown",
    timestamp: new Date().toISOString(),
    colorScheme: typeof document === "undefined"
      ? "unknown"
      : document.documentElement.classList.contains("dark") ? "dark" : "light",
  }
}

function createSubmissionId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function FeedbackDialog({ app, customMetadata, onSubmit, open, onOpenChange }: FeedbackDialogProps) {
  const [description, setDescription] = React.useState("")
  const [submissionId, setSubmissionId] = React.useState(createSubmissionId)
  const [contextData, setContextData] = React.useState<FeedbackContext>()
  const systemInfo = React.useMemo(() => collectSystemInfo(app), [app, open])

  React.useEffect(() => {
    if (open) {
      setDescription("")
      setSubmissionId(createSubmissionId())
      setContextData({ route: location.pathname, title: document.title })
    } else {
      setContextData(undefined)
    }
  }, [open])

  const canSubmit = description.trim().length > 0

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!canSubmit) return
    onSubmit({
      clientSubmissionId: submissionId,
      description: description.trim(),
      systemInfo,
      context: contextData,
      customMetadata,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="feedback-dialog" className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary-a10">
              <i className="ph-bold ph-chat text-lg text-primary" />
            </div>
            <div>
              <DialogTitle>Report Feedback</DialogTitle>
              <DialogDescription>
                Report a bug, request a feature, or share a suggestion
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} data-slot="feedback-form" className="space-y-4">
          <textarea
            id="feedback-description"
            data-slot="feedback-description"
            autoFocus
            maxLength={10000}
            className="w-full min-h-[160px] rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm leading-relaxed transition-colors outline-none resize-y placeholder:text-muted-foreground focus-visible:border-foreground-a20 dark:bg-input-a30"
            placeholder="What's on your mind?"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            required
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" data-slot="feedback-submit" disabled={!canSubmit}>
              <i className="ph-bold ph-paper-plane" />
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { FeedbackDialog }
