import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  CircleHelp,
  Loader2,
  GitMerge,
  Ban,
  UserRoundSearch,
  Bug,
  Lightbulb,
  Bot,
  CircleDot,
} from "lucide-react"
import type { ReviewVerdict } from "../types"

export function verdictIcon(verdict: ReviewVerdict) {
  switch (verdict) {
    case "pass":
      return <CheckCircle className="size-4 text-emerald-400" />
    case "pass_with_notes":
      return <AlertTriangle className="size-4 text-yellow-400" />
    case "reject":
      return <XCircle className="size-4 text-red-400" />
    case "pending_human":
      return <CircleHelp className="size-4 text-blue-400" />
  }
}

export function tackleStatusIcon(status: string) {
  switch (status) {
    case "pending":
    case "running":
      return <Loader2 className="size-4 text-muted-foreground animate-spin" />
    case "awaiting_review":
      return null
    case "awaiting_merge":
      return <CheckCircle className="size-4 text-emerald-400" />
    case "awaiting_human_loop":
      return <UserRoundSearch className="size-4 text-amber-400" />
    case "merging":
      return <Loader2 className="size-4 text-emerald-400 animate-spin" />
    case "merged":
      return <GitMerge className="size-4 text-emerald-400" />
    case "failed":
      return <XCircle className="size-4 text-red-400" />
    case "dismissed":
      return <Ban className="size-4 text-muted-foreground" />
    default:
      return null
  }
}

export function issueTypeIcon(labels: { name: string }[]) {
  const names = labels.map((l) => l.name)
  if (names.includes("bug"))
    return <Bug className="size-4 text-red-400" />
  if (names.includes("feature-request") || names.includes("enhancement"))
    return <Lightbulb className="size-4 text-yellow-400" />
  if (names.includes("ai-reported"))
    return <Bot className="size-4 text-blue-400" />
  return <CircleDot className="size-4 text-muted-foreground" />
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
