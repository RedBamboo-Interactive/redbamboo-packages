import * as React from "react"
import {
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Button,
  Label,
  Separator,
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
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

export interface FeedbackSubmission {
  category: FeedbackCategory
  description: string
  systemInfo: SystemInfo
  customMetadata?: Record<string, string>
}

export interface FeedbackResult {
  issueUrl: string
  title: string
}

export interface FeedbackDialogProps {
  app: { name: string; version: string }
  customMetadata?: Record<string, string>
  onSubmit: (submission: FeedbackSubmission) => void
  open: boolean
  onOpenChange: (open: boolean) => void
}

export interface FeedbackButtonProps {
  onClick: () => void
  className?: string
  variant?: "menu-item" | "button"
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

const categories: { value: FeedbackCategory; label: string; icon: string }[] = [
  { value: "bug", label: "Bug", icon: "fa-solid fa-bug" },
  { value: "feature", label: "Feature", icon: "fa-solid fa-lightbulb" },
  { value: "suggestion", label: "Suggestion", icon: "fa-solid fa-comment" },
]

function FeedbackButton({ onClick, className, variant = "button" }: FeedbackButtonProps) {
  if (variant === "menu-item") {
    return (
      <button
        type="button"
        data-slot="feedback-button"
        onClick={onClick}
        className={cn(
          "relative flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground",
          className
        )}
      >
        <i className="fa-solid fa-message size-4 text-center" />
        Send Feedback
      </button>
    )
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      data-slot="feedback-button"
      onClick={onClick}
      className={className}
    >
      <i className="fa-solid fa-message" />
      Send Feedback
    </Button>
  )
}

function FeedbackDialog({
  app,
  customMetadata,
  onSubmit,
  open,
  onOpenChange,
}: FeedbackDialogProps) {
  const [category, setCategory] = React.useState<FeedbackCategory>("bug")
  const [description, setDescription] = React.useState("")
  const [infoOpen, setInfoOpen] = React.useState(false)

  const systemInfo = React.useMemo(() => collectSystemInfo(app), [app, open])

  React.useEffect(() => {
    if (open) {
      setCategory("bug")
      setDescription("")
      setInfoOpen(false)
    }
  }, [open])

  const canSubmit = description.trim().length > 0

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit) return

    onSubmit({
      category,
      description: description.trim(),
      systemInfo,
      customMetadata,
    })

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-slot="feedback-dialog" className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <i className="fa-solid fa-message text-lg text-primary" />
            </div>
            <div>
              <DialogTitle>Send Feedback</DialogTitle>
              <DialogDescription>
                Help us improve {app.name}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <form onSubmit={handleSubmit} data-slot="feedback-form" className="space-y-4">
          <div className="space-y-2">
            <Label>Category</Label>
            <div data-slot="feedback-category" className="flex gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => setCategory(cat.value)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-xs font-medium transition-colors",
                    category === cat.value
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  )}
                >
                  <i className={cn(cat.icon, "text-[10px]")} />
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="feedback-description">What's on your mind?</Label>
            <textarea
              id="feedback-description"
              data-slot="feedback-description"
              className="w-full min-h-[120px] rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none resize-y placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
              placeholder={
                category === "bug"
                  ? "Describe the issue you encountered..."
                  : category === "feature"
                    ? "Describe the feature you'd like to see..."
                    : "Share your suggestion..."
              }
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              required
            />
          </div>

          <Separator />

          <Collapsible open={infoOpen} onOpenChange={setInfoOpen}>
            <CollapsibleTrigger className="flex w-full cursor-pointer items-center gap-2 text-xs text-muted-foreground transition-colors hover:text-foreground">
              <i className={cn("fa-solid fa-chevron-right text-[10px] transition-transform", infoOpen && "rotate-90")} />
              System info included with submission
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div
                data-slot="feedback-system-info"
                className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
              >
                <span className="font-medium">App</span>
                <span>{systemInfo.appName} v{systemInfo.appVersion}</span>
                <span className="font-medium">Browser</span>
                <span>{systemInfo.browser}</span>
                <span className="font-medium">OS</span>
                <span>{systemInfo.os}</span>
                <span className="font-medium">Screen</span>
                <span>{systemInfo.screenResolution}</span>
                <span className="font-medium">Theme</span>
                <span>{systemInfo.colorScheme}</span>
                {customMetadata && Object.entries(customMetadata).map(([key, value]) => (
                  <React.Fragment key={key}>
                    <span className="font-medium">{key}</span>
                    <span>{value}</span>
                  </React.Fragment>
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>

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
              <i className="fa-solid fa-paper-plane" />
              Send
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export { FeedbackDialog, FeedbackButton }
