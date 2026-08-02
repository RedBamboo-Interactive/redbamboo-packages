import * as React from "react"
import { cn } from "../utils"
import { Button } from "./button"
import { Input } from "./input"

export type ProtectedValueProtection = "encrypted" | "hashed" | "legacy" | "unavailable"
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

export interface ProtectedValueFieldProps {
  id?: string
  label?: string
  description?: string
  status: ProtectedValueStatus
  placeholder?: string
  disabled?: boolean
  canVerify?: boolean
  allowClear?: boolean
  className?: string
  onReplace: (value: string) => Promise<void> | void
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
  placeholder = "Enter a secret",
  disabled,
  canVerify,
  allowClear = true,
  className,
  onReplace,
  onVerify,
  onClear,
}: ProtectedValueFieldProps) {
  const generatedId = React.useId()
  const inputId = id ?? generatedId
  const [editing, setEditing] = React.useState(!status.configured)
  const [draft, setDraft] = React.useState("")
  const [reveal, setReveal] = React.useState(false)
  const [busy, setBusy] = React.useState<"save" | "verify" | "clear" | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [confirmClear, setConfirmClear] = React.useState(false)

  React.useEffect(() => {
    if (!status.configured) setEditing(true)
    else if (!draft) setEditing(false)
  }, [status.configured, draft])

  const replace = async () => {
    if (!draft) return
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

  const verify = async () => {
    if (!onVerify) return
    setBusy("verify")
    setError(null)
    try { await onVerify() }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the secret")
    } finally { setBusy(null) }
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
    } finally { setBusy(null) }
  }

  const verification = status.verification ?? "unverified"
  const checkedTitle = status.checkedAt
    ? `Last checked ${new Date(status.checkedAt).toLocaleString()}`
    : undefined

  return (
    <div className={cn("space-y-2", className)}>
      {label && <label htmlFor={inputId} className="text-sm font-medium text-foreground">{label}</label>}

      {editing ? (
        <div className="rounded-lg border border-input bg-background p-2.5 shadow-sm focus-within:ring-1 focus-within:ring-ring">
          <div className="flex items-center gap-2">
            <Input
              id={inputId}
              type={reveal ? "text" : "password"}
              value={draft}
              disabled={disabled || busy !== null}
              autoComplete="new-password"
              spellCheck={false}
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
          </div>
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
              {busy === "save" ? "Saving…" : status.configured ? "Save replacement" : "Save secret"}
            </Button>
          </div>
        </div>
      ) : (
        <div className="relative overflow-hidden rounded-lg border border-input bg-background px-3 py-2.5 shadow-sm">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 left-0 w-28 border-r border-primary/10 opacity-55"
            style={{
              backgroundImage:
                "repeating-linear-gradient(115deg, transparent 0 7px, color-mix(in srgb, var(--primary) 10%, transparent) 7px 8px), radial-gradient(circle at 25% 35%, color-mix(in srgb, var(--primary) 18%, transparent) 0 1px, transparent 1.5px)",
              backgroundSize: "auto, 11px 11px",
            }}
          />
          <div className="relative flex min-w-0 items-center gap-2">
            <span aria-hidden="true" className="w-20 shrink-0 truncate font-mono text-[10px] tracking-[0.22em] text-primary/70">
              7F·A9·C2·E4
            </span>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" role="status" aria-live="polite">
              <StatusPill tone="neutral">Saved</StatusPill>
              <StatusPill tone={status.protection === "unavailable" ? "danger" : "secure"}>
                {status.protection === "hashed" ? "Hashed" :
                  status.protection === "legacy" ? "Needs protection" :
                    status.protection === "unavailable" ? "Unavailable" : "Encrypted"}
              </StatusPill>
              {status.protection !== "hashed" && (
                <StatusPill
                  title={checkedTitle}
                  tone={verification === "verified" ? "success" : verification === "rejected" ? "danger" :
                    verification === "unreachable" ? "warning" : "neutral"}
                >
                  {verificationLabels[verification]}
                </StatusPill>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {canVerify && onVerify && (
                <Button type="button" variant="ghost" size="xs" disabled={disabled || busy !== null}
                  onClick={() => void verify()}>
                  {busy === "verify" ? "Checking…" : "Verify"}
                </Button>
              )}
              <Button type="button" variant="ghost" size="xs" disabled={disabled || busy !== null}
                onClick={() => setEditing(true)}>
                Replace
              </Button>
            </div>
          </div>

          {allowClear && onClear && (
            <div className="relative mt-2 flex justify-end">
              {confirmClear ? (
                <div className="flex items-center gap-2 text-xs text-destructive">
                  <span>Clear this saved value?</span>
                  <Button type="button" variant="destructive" size="xs" disabled={busy !== null}
                    onClick={() => void clear()}>{busy === "clear" ? "Clearing…" : "Clear"}</Button>
                  <Button type="button" variant="ghost" size="xs" disabled={busy !== null}
                    onClick={() => setConfirmClear(false)}>Cancel</Button>
                </div>
              ) : (
                <button type="button" disabled={disabled || busy !== null}
                  className="text-[11px] text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50"
                  onClick={() => setConfirmClear(true)}>Clear saved value</button>
              )}
            </div>
          )}
        </div>
      )}

      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      {error && <p className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  )
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
