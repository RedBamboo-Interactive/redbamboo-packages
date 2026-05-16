import { useState, useCallback, useRef } from "react"
import {
  Bug,
  Lightbulb,
  MoreHorizontal,
  Loader2,
  ExternalLink,
  CheckCircle,
  XCircle,
} from "lucide-react"
import { Button, Input, Badge } from "@redbamboo/ui"
import type { IssueClient } from "../api/issue-client"

const TYPES = [
  { value: "bug", label: "Bug", icon: Bug },
  { value: "feature", label: "Feature", icon: Lightbulb },
  { value: "other", label: "Other", icon: MoreHorizontal },
] as const

const LABEL_OPTIONS = [
  "bug",
  "feature-request",
  "enhancement",
  "docs",
  "priority-high",
  "priority-low",
]

interface Props {
  open: boolean
  onClose: () => void
  issueClient: IssueClient | null
  onCreated?: () => void
}

export function NewIssueModal({ open, onClose, issueClient, onCreated }: Props) {
  const [type, setType] = useState<string>("bug")
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [selectedLabels, setSelectedLabels] = useState<Set<string>>(new Set(["bug"]))
  const [submitting, setSubmitting] = useState(false)
  const [status, setStatus] = useState("")
  const [result, setResult] = useState<{
    ok: boolean
    issue_url?: string
    refined_title?: string
    error?: string
  } | null>(null)
  const streamRef = useRef<{ close: () => void } | null>(null)

  const toggleLabel = (label: string) => {
    setSelectedLabels((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      return next
    })
  }

  const handleSubmit = useCallback(() => {
    if (!title.trim() || !description.trim() || !issueClient) return
    setSubmitting(true)
    setStatus("")
    setResult(null)

    const stream = issueClient.createIssue({
      title: title.trim(),
      description: description.trim(),
      type: type as "bug" | "feature" | "other",
      labels: [...selectedLabels],
    })
    streamRef.current = stream

    stream
      .onStatus((s) => setStatus(s))
      .onDone((r) => {
        setResult({ ok: true, issue_url: r.issue_url, refined_title: r.refined_title })
        setSubmitting(false)
        onCreated?.()
      })
      .onError((err) => {
        setResult({ ok: false, error: err })
        setSubmitting(false)
      })
  }, [title, description, type, selectedLabels, issueClient, onCreated])

  const handleClose = () => {
    if (submitting) {
      streamRef.current?.close()
      streamRef.current = null
      setSubmitting(false)
    }
    setTitle("")
    setDescription("")
    setType("bug")
    setSelectedLabels(new Set(["bug"]))
    setResult(null)
    setStatus("")
    onClose()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-surface border border-border rounded-lg shadow-xl w-full max-w-lg mx-4">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium">New Issue</h2>
          <button
            onClick={handleClose}
            className="text-text-muted hover:text-contrast text-lg leading-none"
          >
            &times;
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Type selector */}
          <div className="flex gap-1">
            {TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => {
                  setType(t.value)
                  if (t.value === "bug" && !selectedLabels.has("bug"))
                    setSelectedLabels((prev) => new Set([...prev, "bug"]))
                }}
                disabled={submitting}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-xs transition-colors ${
                  type === t.value
                    ? "bg-overlay-15 text-contrast"
                    : "text-text-muted hover:text-contrast hover:bg-overlay-5"
                }`}
              >
                <t.icon className="size-3.5" />
                {t.label}
              </button>
            ))}
          </div>

          {/* Title */}
          <Input
            placeholder="Brief summary..."
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={submitting}
            className="text-sm"
          />

          {/* Description */}
          <textarea
            placeholder="Detailed description — AI will enrich this with codebase context..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            disabled={submitting}
            rows={5}
            className="w-full rounded-md border border-border bg-transparent px-3 py-2 text-sm text-contrast placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-ring resize-none"
          />

          {/* Labels */}
          <div className="flex flex-wrap gap-1.5">
            {LABEL_OPTIONS.map((label) => (
              <button
                key={label}
                onClick={() => toggleLabel(label)}
                disabled={submitting}
              >
                <Badge
                  variant={selectedLabels.has(label) ? "default" : "outline"}
                  className="text-[10px] cursor-pointer"
                >
                  {label}
                </Badge>
              </button>
            ))}
          </div>

          {/* Live status */}
          {submitting && (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <Loader2 className="size-4 animate-spin" />
              <span>{status || "Starting..."}</span>
            </div>
          )}

          {/* Result */}
          {result && !submitting && (
            <div className={`flex items-start gap-2 text-sm rounded-md p-3 ${
              result.ok ? "bg-emerald-500/10 text-emerald-400" : "bg-red-500/10 text-red-400"
            }`}>
              {result.ok ? (
                <>
                  <CheckCircle className="size-4 mt-0.5 flex-none" />
                  <div>
                    <p className="font-medium">
                      Issue created{result.refined_title ? `: ${result.refined_title}` : ""}
                    </p>
                    {result.issue_url && (
                      <a
                        href={result.issue_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 mt-1 text-xs underline"
                      >
                        View on GitHub <ExternalLink className="size-3" />
                      </a>
                    )}
                  </div>
                </>
              ) : (
                <>
                  <XCircle className="size-4 mt-0.5 flex-none" />
                  <p>{result.error}</p>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <Button variant="ghost" size="sm" onClick={handleClose}>
            {result?.ok ? "Done" : submitting ? "Cancel" : "Close"}
          </Button>
          {!result?.ok && (
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || !title.trim() || !description.trim() || !issueClient}
            >
              {submitting ? (
                <>
                  <Loader2 className="size-3.5 mr-1.5 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Issue"
              )}
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
