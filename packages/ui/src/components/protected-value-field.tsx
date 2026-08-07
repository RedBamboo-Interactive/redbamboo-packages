import * as React from "react"
import { cn } from "../utils"
import { Button } from "./button"
import { Input } from "./input"

export type ProtectedValueProtection = "encrypted" | "hashed" | "pending" | "legacy" | "unknown" | "unavailable"
export type ProtectedValueVerification =
  | "unverified"
  | "checking"
  | "verified"
  | "rejected"
  | "unreachable"

export interface ProtectedValueStatus {
  configured: boolean
  protection: ProtectedValueProtection
  verification?: ProtectedValueVerification
  checkedAt?: string | null
  verifiedAt?: string | null
  resultCode?: string | null
}

export type ProtectedValueKind = "secret" | "password" | "token" | "credential-file"

export interface ProtectedValueFieldProps {
  id?: string
  label?: string
  description?: string
  status: ProtectedValueStatus
  kind?: ProtectedValueKind
  placeholder?: string
  autoComplete?: React.HTMLInputAutoCompleteAttribute
  fileAccept?: string
  validateDraft?: (value: string) => string | null | undefined
  disabled?: boolean
  canVerify?: boolean
  replaceable?: boolean
  allowClear?: boolean
  className?: string
  onReplace?: (value: string) => Promise<void> | void
  onRotate?: () => Promise<void> | void
  onVerify?: () => Promise<void> | void
  onClear?: () => Promise<void> | void
}

const verificationLabels: Record<ProtectedValueVerification, string> = {
  unverified: "Not checked",
  checking: "Checking",
  verified: "Verified",
  rejected: "Rejected",
  unreachable: "Unreachable",
}

export function ProtectedValueField({
  id,
  label,
  description,
  status,
  kind = "secret",
  placeholder = "Enter a secret",
  autoComplete = "new-password",
  fileAccept = "application/json,.json",
  validateDraft,
  disabled,
  canVerify,
  allowClear = true,
  className,
  onReplace,
  replaceable = onReplace != null,
  onRotate,
  onVerify,
  onClear,
}: ProtectedValueFieldProps) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const descriptionId = description ? `${inputId}-description` : undefined
  const errorId = `${inputId}-error`
  const [editing, setEditing] = React.useState(replaceable && !status.configured)
  const [draft, setDraft] = React.useState("")
  const [reveal, setReveal] = React.useState(false)
  const [busy, setBusy] = React.useState<"save" | "rotate" | "verify" | "clear" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmClear, setConfirmClear] = React.useState(false)

  React.useEffect(() => {
    if (!status.configured && replaceable) setEditing(true)
    else if (!draft) setEditing(false)
  }, [status.configured, draft, replaceable])

  const replace = async () => {
    if (!draft || !onReplace) return
    const validationError = validateDraft?.(draft)
    if (validationError) {
      setError(validationError)
      return
    }
    setBusy("save")
    setError(null)
    try {
      await onReplace(draft)
      setDraft("")
      setReveal(false)
      setEditing(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the secret")
    } finally {
      setBusy(null)
    }
  }

  const rotate = async () => {
    if (!onRotate) return
    setBusy("rotate")
    setError(null)
    try {
      await onRotate()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not rotate the secret")
    } finally {
      setBusy(null)
    }
  }

  const verify = async () => {
    if (!onVerify) return
    setBusy("verify")
    setError(null)
    try {
      await onVerify()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the secret")
    } finally {
      setBusy(null)
    }
  }

  const clear = async () => {
    if (!onClear) return
    setBusy("clear")
    setError(null)
    try {
      await onClear()
      setConfirmClear(false)
      setDraft("")
      setEditing(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not clear the secret")
    } finally {
      setBusy(null)
    }
  }

  const verification = status.verification ?? "unverified"
  const checkedTitle = status.checkedAt
    ? `Last checked ${new Date(status.checkedAt).toLocaleString()}`
    : undefined
  const presentation = protectionPresentation(status.protection)
  const verificationTone = verification === "verified" ? "success" : verification === "rejected" ? "danger" :
    verification === "unreachable" ? "warning" : "neutral"
  const icon = kind === "password" ? "ph-password" :
    kind === "credential-file" ? "ph-file-lock" : "ph-key"

  return (
    <div
      data-slot="protected-value-field"
      data-kind={kind}
      data-configured={status.configured ? "true" : "false"}
      data-protection={status.protection}
      data-verification={verification}
      className={cn("@container/protected min-w-0 space-y-2", className)}
    >
      {label && <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>}

      {editing ? (
        <div className="rounded-lg border border-input bg-background p-2.5 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <div className="flex items-center gap-2">
            {kind === "credential-file" ? (
              <textarea
                id={inputId}
                rows={4}
                value={draft}
                disabled={disabled || busy !== null}
                spellCheck={false}
                aria-describedby={[descriptionId, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
                placeholder={status.configured ? "Paste replacement credential JSON" : placeholder}
                className="min-h-20 flex-1 resize-y bg-transparent px-1 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground"
                onChange={(event) => {
                  setDraft(event.target.value)
                  setError(null)
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape" && status.configured) {
                    event.preventDefault()
                    setDraft("")
                    setError(null)
                    setEditing(false)
                  }
                }}
              />
            ) : (
              <>
                <Input
                  id={inputId}
                  type={reveal ? "text" : "password"}
                  value={draft}
                  disabled={disabled || busy !== null}
                  autoComplete={autoComplete}
                  spellCheck={false}
                  aria-describedby={[descriptionId, error ? errorId : undefined].filter(Boolean).join(" ") || undefined}
                  placeholder={status.configured ? "Enter a replacement" : placeholder}
                  className="h-8 flex-1 border-0 bg-transparent px-1 font-mono text-xs shadow-none focus-visible:ring-0"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && draft) {
                      event.preventDefault()
                      void replace()
                    }
                    if (event.key === "Escape" && status.configured) {
                      event.preventDefault()
                      setDraft("")
                      setError(null)
                      setEditing(false)
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={disabled || busy !== null || !draft}
                  aria-label={reveal ? "Hide newly entered value" : "Show newly entered value"}
                  onClick={() => setReveal((value) => !value)}
                >
                  {reveal ? "Hide" : "Show"}
                </Button>
              </>
            )}
          </div>
          {kind === "credential-file" && (
            <div className="mt-2 flex min-w-0 flex-col items-stretch gap-1.5 border-t border-border/70 pt-2">
              <input
                type="file"
                accept={fileAccept}
                disabled={disabled || busy !== null}
                aria-label="Choose credential file"
                className="min-w-0 flex-1 text-[11px] text-muted-foreground file:mr-2 file:rounded file:border-0 file:bg-muted file:px-2 file:py-1 file:text-[11px] file:text-foreground"
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  event.target.value = ""
                  if (!file) return
                  try {
                    setDraft(await file.text())
                    setError(null)
                  } catch {
                    setError("Could not read that credential file")
                  }
                }}
              />
              <span className="text-[11px] text-muted-foreground">Or paste the JSON above.</span>
            </div>
          )}
          <div className="mt-2 flex items-center justify-end gap-2">
            {status.configured && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={disabled || busy !== null}
                onClick={() => {
                  setDraft("")
                  setError(null)
                  setEditing(false)
                }}
              >
                Cancel
              </Button>
            )}
            <Button
              type="button"
              size="xs"
              disabled={disabled || busy !== null || !draft}
              onClick={() => void replace()}
            >
              {busy === "save" ? "Saving..." : status.configured ? "Save replacement" : "Save secret"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-lg border border-input bg-background shadow-sm">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-0 h-10 border-b border-primary/10 opacity-50"
            style={{
              backgroundImage:
                "repeating-linear-gradient(115deg, transparent 0 7px, color-mix(in srgb, var(--primary) 10%, transparent) 7px 8px), radial-gradient(circle at 25% 35%, color-mix(in srgb, var(--primary) 18%, transparent) 0 1px, transparent 1.5px)",
              backgroundSize: "auto, 11px 11px",
            }}
          />
          <div className="relative min-w-0 px-3 py-2.5">
            <div className="flex min-w-0 items-center gap-3">
              <div aria-hidden="true" className="flex shrink-0 items-center gap-2 text-primary/75">
                <i className={cn("ph-bold text-base", icon)} />
                <span className="hidden font-mono text-[9px] tracking-[0.16em] @min-[140px]/protected:inline">
                  VX/7Q/K9
                </span>
              </div>
              <div
                className={cn(
                  "sr-only text-xs font-medium @min-[185px]/protected:not-sr-only @min-[185px]/protected:min-w-0 @min-[185px]/protected:flex-1 @min-[185px]/protected:text-right",
                  presentation.textClass,
                )}
                role="status"
                aria-live="polite"
              >
                {presentation.summary}
              </div>
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-1.5">
              <StatusPill tone={presentation.tone}>{presentation.detail}</StatusPill>
              {status.protection !== "hashed" && (
                <StatusPill title={checkedTitle} tone={verificationTone}>
                  {verificationLabels[verification]}
                </StatusPill>
              )}
            </div>
          </div>

          {(canVerify && onVerify || onRotate || replaceable && onReplace || allowClear && onClear) && (
            <div className="relative flex min-w-0 flex-wrap items-center justify-end gap-1 border-t border-border/70 bg-muted/15 px-2 py-1.5">
              {canVerify && onVerify && (
                <Button type="button" variant="ghost" size="xs" disabled={disabled || busy !== null}
                  onClick={() => void verify()}>
                  {busy === "verify" ? "Checking..." : "Verify"}
                </Button>
              )}
              {onRotate && (
                <Button type="button" variant="ghost" size="xs" disabled={disabled || busy !== null}
                  onClick={() => void rotate()}>
                  {busy === "rotate" ? "Rotating..." : "Rotate"}
                </Button>
              )}
              {replaceable && onReplace && (
                <Button type="button" variant="ghost" size="xs" disabled={disabled || busy !== null}
                  onClick={() => {
                    setConfirmClear(false)
                    setEditing(true)
                  }}>
                  Replace
                </Button>
              )}
              {allowClear && onClear && !confirmClear && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={disabled || busy !== null}
                  aria-label="Clear saved value"
                  title="Clear saved value"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmClear(true)}
                >
                  <i className="ph-bold ph-trash" aria-hidden="true" />
                </Button>
              )}
            </div>
          )}

          {allowClear && onClear && confirmClear && (
            <div className="relative flex items-center justify-end gap-2 border-t border-border/70 bg-muted/25 px-3 py-2 text-xs text-destructive">
              <span className="mr-auto">Remove this saved value?</span>
              <Button type="button" variant="ghost" size="xs" disabled={busy !== null}
                onClick={() => setConfirmClear(false)}>Keep</Button>
              <Button type="button" variant="destructive" size="xs" disabled={busy !== null}
                onClick={() => void clear()}>{busy === "clear" ? "Clearing..." : "Remove"}</Button>
            </div>
          )}
        </div>
      )}

      {description && <p id={descriptionId} className="text-xs text-muted-foreground">{description}</p>}
      {error && <p id={errorId} className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  )
}

function protectionPresentation(protection: ProtectedValueProtection): {
  summary: string
  detail: string
  tone: "secure" | "warning" | "danger"
  textClass: string
} {
  switch (protection) {
    case "hashed":
      return { summary: "Password is set", detail: "One-way hash", tone: "secure", textClass: "text-foreground" }
    case "pending":
      return { summary: "Ready to apply", detail: "Not stored yet", tone: "warning", textClass: "text-amber-600 dark:text-amber-400" }
    case "legacy":
      return { summary: "Saved value needs protection", detail: "Legacy storage", tone: "warning", textClass: "text-amber-600 dark:text-amber-400" }
    case "unavailable":
      return { summary: "Secure storage unavailable", detail: "Not protected", tone: "danger", textClass: "text-destructive" }
    case "unknown":
      return { summary: "Storage status unavailable", detail: "Protection unknown", tone: "warning", textClass: "text-amber-600 dark:text-amber-400" }
    default:
      return { summary: "Stored securely", detail: "Encrypted", tone: "secure", textClass: "text-foreground" }
  }
}

function StatusPill({
  children,
  tone,
  title,
}: {
  children: React.ReactNode
  tone: "neutral" | "secure" | "success" | "warning" | "danger"
  title?: string
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[10px] font-medium",
        tone === "neutral" && "border-border bg-muted/50 text-muted-foreground",
        tone === "secure" && "border-primary/25 bg-primary/10 text-primary",
        tone === "success" && "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
        tone === "warning" && "border-amber-500/25 bg-amber-500/10 text-amber-600 dark:text-amber-400",
        tone === "danger" && "border-destructive/25 bg-destructive/10 text-destructive",
      )}
    >
      {children}
    </span>
  )
}
