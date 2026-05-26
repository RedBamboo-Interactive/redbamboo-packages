import type { ReactNode } from "react"
import type { FeedbackSubmission, FeedbackResult } from "./feedback-dialog"

export interface AppShellBrand {
  icon: string
  nameParts: [string, string]
  accentClass?: string
}

export interface AppShellShare {
  url: () => string | undefined
  title?: string
  description?: string
}

export interface AppShellConfig {
  name: string
  version: string
  description?: string
  icon?: string

  brand: AppShellBrand

  github?: {
    app?: string
    company?: string
  }

  latestVersion?: string

  share?: AppShellShare

  onFeedbackSubmit?: (submission: FeedbackSubmission) => Promise<FeedbackResult>
  feedbackMetadata?: Record<string, string>
}

export interface AppShellProps {
  config: AppShellConfig
  headerContent?: ReactNode
  menuItems?: ReactNode
  children: ReactNode
  className?: string
}
