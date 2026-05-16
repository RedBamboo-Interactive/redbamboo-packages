import type { ReviewVerdict } from "../types"

export function verdictIcon(verdict: ReviewVerdict) {
  switch (verdict) {
    case "pass":
      return <i className="fa-solid fa-circle-check text-sm text-emerald-400" />
    case "pass_with_notes":
      return <i className="fa-solid fa-triangle-exclamation text-sm text-yellow-400" />
    case "reject":
      return <i className="fa-solid fa-circle-xmark text-sm text-red-400" />
    case "pending_human":
      return <i className="fa-solid fa-circle-question text-sm text-blue-400" />
  }
}

export function tackleStatusIcon(status: string) {
  switch (status) {
    case "pending":
    case "running":
      return <i className="fa-solid fa-spinner fa-spin text-sm text-text-muted" />
    case "awaiting_review":
      return null
    case "awaiting_merge":
      return <i className="fa-solid fa-circle-check text-sm text-emerald-400" />
    case "awaiting_human_loop":
      return <i className="fa-solid fa-user-magnifying-glass text-sm text-accent-gold" />
    case "merging":
      return <i className="fa-solid fa-spinner fa-spin text-sm text-emerald-400" />
    case "merged":
      return <i className="fa-solid fa-code-merge text-sm text-emerald-400" />
    case "failed":
      return <i className="fa-solid fa-circle-xmark text-sm text-red-400" />
    case "dismissed":
      return <i className="fa-solid fa-ban text-sm text-text-muted" />
    default:
      return null
  }
}

export function issueTypeIcon(labels: { name: string }[]) {
  const names = labels.map((l) => l.name)
  if (names.includes("bug"))
    return <i className="fa-solid fa-bug text-sm text-red-400" />
  if (names.includes("feature-request") || names.includes("enhancement"))
    return <i className="fa-solid fa-lightbulb text-sm text-yellow-400" />
  if (names.includes("ai-reported"))
    return <i className="fa-solid fa-robot text-sm text-blue-400" />
  return <i className="fa-solid fa-circle-dot text-sm text-text-muted" />
}

export function timeAgo(iso: string): string {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const seconds = Math.floor((now - then) / 1000)

  if (seconds < 60) return "just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  return `${months}mo ago`
}
