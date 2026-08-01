export type FeedbackCategory = "bug" | "feature" | "suggestion"

export interface FeedbackDestination {
  endpoint: string
  publisherId: string
  publisherName: string
  productId: string
  productName: string
  privacyUrl?: string
}

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
  route: string
  title: string
}

export interface FeedbackSubmission {
  clientSubmissionId: string
  /** Optional for custom submitters; the external reporter always replaces it with the AI result. */
  category?: FeedbackCategory
  description: string
  systemInfo: SystemInfo
  context?: FeedbackContext
  customMetadata?: Record<string, string>
}

export interface FeedbackResult {
  reportId?: string
  status?: "accepted"
  receivedAt?: string
  title: string
  issueUrl?: string
}
