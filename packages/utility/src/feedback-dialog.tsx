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

// -- Types ------------------------------------------------------------------

export type FeedbackCategory = "bug" | "feature" | "suggestion"

export interface SystemInfo {
  appName: string
  appVersion: string
  browser: string
  os: string
  screenResolution: string
  currentUrl: string
  timestamp: string
  colorScheme: "light" | "dark" | "unknown"
}

export interface FeedbackContext {
  url: string
  route: string
  title: string
  screenshot?: string
  domContext?: Record<string, unknown>
}

export interface FeedbackSubmission {
  category?: FeedbackCategory
  description: string
  systemInfo: SystemInfo
  context?: FeedbackContext
  customMetadata?: Record<string, string>
}

export interface FeedbackResult {
  issueUrl: string
  title: string
}

export interface FeedbackDialogProps {
  app: { name: string; version: string }
  customMetadata?: Record<string, string>
  captureScreenshot?: () => Promise<string | undefined>
  onSubmit: (submission: FeedbackSubmission) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

// -- Utilities --------------------------------------------------------------

function parseBrowser(ua: string): string {
  if (ua.includes("Firefox/")) {
    const match = ua.match(/Firefox\/([\d.]+)/)
    return `Firefox ${match?.[1] ?? ""}`
  }
  if (ua.includes("Edg/")) {
    const match = ua.match(/Edg\/([\d.]+)/)
    return `Edge ${match?.[1] ?? ""}`
  }
  if (ua.includes("Chrome/")) {
    const match = ua.match(/Chrome\/([\d.]+)/)
    return `Chrome ${match?.[1] ?? ""}`
  }
  if (ua.includes("Safari/") && !ua.includes("Chrome")) {
    const match = ua.match(/Version\/([\d.]+)/)
    return `Safari ${match?.[1] ?? ""}`
  }
  return ua.slice(0, 50)
}

function parseOS(ua: string): string {
  if (ua.includes("Windows NT 10.0")) return "Windows 10/11"
  if (ua.includes("Windows NT")) return "Windows"
  if (ua.includes("Mac OS X")) {
    const match = ua.match(/Mac OS X ([\d_]+)/)
    return `macOS ${match?.[1]?.replace(/_/g, ".") ?? ""}`
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
    screenResolution:
      typeof screen !== "undefined"
        ? `${screen.width}x${screen.height}`
        : "unknown",
    currentUrl: typeof location !== "undefined" ? location.href : "unknown",
    timestamp: new Date().toISOString(),
    colorScheme:
      typeof document !== "undefined"
        ? document.documentElement.classList.contains("dark")
          ? "dark"
          : "light"
        : "unknown",
  }
}

// -- Components -------------------------------------------------------------

function FeedbackDialog({
  app,
  customMetadata,
  captureScreenshot,
  onSubmit,
  open,
  onOpenChange,
}: FeedbackDialogProps) {
  const [description, setDescription] = React.useState("")
  const [screenshot, setScreenshot] = React.useState<string | undefined>()
  const [contextData, setContextData] = React.useState<FeedbackContext | undefined>()

  const systemInfo = React.useMemo(() => collectSystemInfo(app), [app, open])

  React.useEffect(() => {
    if (open) {
      setDescription("")
      setContextData({
        url: location.href,
        route: location.pathname + location.search,
        title: document.title,
      })
      if (captureScreenshot) {
        captureScreenshot().then(s => setScreenshot(s)).catch(() => {})
      }
    } else {
      setScreenshot(undefined)
      setContextData(undefined)
    }
  }, [open, captureScreenshot])

  const canSubmit = description.trim().length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    onSubmit({
      description: description.trim(),
      systemInfo,
      context: contextData ? { ...contextData, screenshot } : undefined,
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
            className="w-full min-h-[160px] rounded-lg border border-input bg-transparent px-3 py-2.5 text-sm leading-relaxed transition-colors outline-none resize-y placeholder:text-muted-foreground focus-visible:border-foreground-a20 dark:bg-input-a30"
            placeholder="What's on your mind?"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            required
          />

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              data-slot="feedback-submit"
              disabled={!canSubmit}
            >
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
