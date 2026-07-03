import type { ReactNode } from "react"
import type { FeedbackSubmission, FeedbackResult } from "./feedback-dialog"
import type { SwitcherApp } from "./app-switcher"

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
  breadcrumb?: ReactNode
  menuItems?: ReactNode
  children: ReactNode
  className?: string
  /**
   * Host-supplied app list for the switcher (and its "Open …" commands).
   * Replaces Red Suite port discovery — used by Leaf, where apps are
   * plugin routes on the same origin.
   */
  switcherApps?: SwitcherApp[]
}
