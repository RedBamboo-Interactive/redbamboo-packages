import * as React from "react"
import { cn } from "../utils"
import { Badge } from "./badge"
import { Button } from "./button"
import { Icon } from "./icon"
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
  /** When the saved value last changed. Shown as "saved <date>" in the status line. */
  updatedAt?: string | null
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
  /** When the saved value last changed; takes precedence over `status.updatedAt`. */
  updatedAt?: string | null
  /**
   * Drops the card chrome and the icon tile, label and verified badge, leaving the status
   * line, the masked well and the action rail. For lists whose row already shows the name.
   */
  embedded?: boolean
  /** Names the value in the remove confirmation ("Remove <removeLabel>?"); defaults to `label`. */
  removeLabel?: string
  /** Muted line under the remove question, such as how long the value can be restored. */
  removeNotice?: string
  className?: string
  onReplace?: (value: string) => Promise<void> | void
  onRotate?: () => Promise<void> | void
  onVerify?: () => Promise<void> | void
  onClear?: () => Promise<void> | void
  /**
   * A value the caller may show once, such as the token returned by a rotation. It is
   * rendered inside the stored-value card with a copy action until the caller clears it;
   * the field never stores, logs, or reuses it. Focus moves to it when it appears.
   */
  revealedValue?: string | null
  /** Short one-time visibility notice shown with `revealedValue`. */
  revealedValueNotice?: string
  /** Reports the outcome of the built-in copy action for `revealedValue`. */
  onRevealedValueCopy?: (result: "copied" | "failed") => void
}

export type ProtectedValueCopyState = "idle" | "copied" | "failed"

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
  updatedAt,
  embedded = false,
  removeLabel,
  removeNotice,
  className,
  onReplace,
  replaceable = onReplace != null,
  onRotate,
  onVerify,
  onClear,
  revealedValue,
  revealedValueNotice = "Shown once. After you leave, nobody can read it again.",
  onRevealedValueCopy,
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
  const [copyState, setCopyState] = React.useState<ProtectedValueCopyState>("idle")
  const revealedRef = React.useRef<HTMLDivElement>(null)
  const revealedValueRef = React.useRef<HTMLInputElement>(null)
  const revealedNoticeId = `${inputId}-revealed-notice`

  React.useEffect(() => {
    if (!status.configured && replaceable) setEditing(true)
    else if (!draft) setEditing(false)
  }, [status.configured, draft, replaceable])

  React.useEffect(() => {
    setCopyState("idle")
    const node = revealedRef.current
    if (!revealedValue || !node) return
    revealedValueRef.current?.focus({ preventScroll: true })
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
    node.scrollIntoView({ block: "nearest", behavior: reduceMotion ? "auto" : "smooth" })
  }, [revealedValue])

  const copyRevealedValue = async () => {
    if (!revealedValue) return
    try {
      await navigator.clipboard.writeText(revealedValue)
      setCopyState("copied")
      onRevealedValueCopy?.("copied")
    } catch {
      // Clipboard access is unavailable on insecure origins and some mobile browsers:
      // select the value so it can be copied by hand.
      revealedValueRef.current?.focus()
      revealedValueRef.current?.select()
      setCopyState("failed")
      onRevealedValueCopy?.("failed")
    }
  }

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

  const closeEditor = () => {
    setDraft("")
    setError(null)
    setEditing(false)
  }

  const verification = status.verification ?? "unverified"
  const checkedAt = status.verifiedAt ?? status.checkedAt
  const presentation = protectionPresentation(status.protection, status.configured)
  const title = label ?? defaultLabels[kind]
  const revealedLabel = `New ${kind === "credential-file" ? "credential" : kind}`
  const tileIcon = kind === "password" ? "ph-bold ph-password" :
    kind === "credential-file" ? "ph-bold ph-file-lock" : "ph-bold ph-key"
  // An embedded field sits under a row that already shows the name, badge and saved date.
  const savedAt = status.configured && !embedded ? formatStamp(updatedAt ?? status.updatedAt) : null
  const lastChecked = verification === "verified" ? formatStamp(checkedAt) : null
  const statusText = [presentation.summary, savedAt && `saved ${savedAt}`, lastChecked && `checked ${lastChecked}`]
    .filter(Boolean).join(" · ")
  // Only a field that can be checked reports a check state; others never say "Not checked".
  const showVerification = Boolean(canVerify) && status.configured && status.protection !== "hashed"
  const checkedTitle = checkedAt ? `Last checked ${new Date(checkedAt).toLocaleString()}` : undefined
  const describedBy = [descriptionId, error ? errorId : undefined].filter(Boolean).join(" ") || undefined
  const locked = disabled || busy !== null
  const showRail = Boolean(revealedValue || canVerify && onVerify || onRotate || replaceable && onReplace ||
    allowClear && onClear)

  const verificationBadge = showVerification && !embedded && (
    <Badge
      variant={verification === "rejected" ? "destructive" : verification === "verified" ? "default" : "outline"}
      className={cn(verification === "verified" && "bg-accent-teal-a15 text-accent-teal")}
      title={checkedTitle}
    >
      {verification === "verified" && <Icon name="ph-bold ph-seal-check" className="text-[11px]" aria-hidden="true" />}
      {verificationLabels[verification]}
    </Badge>
  )

  return (
    <div
      data-slot="protected-value-field"
      data-kind={kind}
      data-configured={status.configured ? "true" : "false"}
      data-protection={status.protection}
      data-verification={verification}
      data-revealed={revealedValue ? "true" : undefined}
      data-embedded={embedded ? "true" : undefined}
      className={cn("@container/protected min-w-0 space-y-2", className)}
    >
      <div className={cn("min-w-0 overflow-hidden", !embedded && "rounded-lg border border-border bg-card")}>
        <div className={cn("flex min-w-0 items-center gap-3", embedded ? "px-3 pb-2.5 pt-1" : "px-3 py-3")}>
          {!embedded && (
            <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-lg bg-primary-a15 text-primary">
              <Icon name={tileIcon} className="text-base" />
            </span>
          )}
          <div className="min-w-0 flex-1">
            {!embedded && (
              <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                {editing ? (
                  <label htmlFor={inputId} className="min-w-0 break-words text-sm font-medium text-foreground">{title}</label>
                ) : (
                  <span className="min-w-0 break-words text-sm font-medium text-foreground">{title}</span>
                )}
                {verificationBadge}
              </div>
            )}
            <p
              role="status"
              aria-live="polite"
              title={checkedTitle}
              className={cn(
                "flex min-w-0 items-start gap-1 text-xs",
                !embedded && "mt-0.5",
                presentation.tone === "danger" ? "text-destructive" : "text-muted-foreground",
              )}
            >
              <Icon name={presentation.icon} className="mt-[3px] shrink-0 text-[11px]" aria-hidden="true" />
              <span className="min-w-0">{statusText}</span>
            </p>
                      </div>
          {status.configured && !editing && (
            <span
              aria-hidden="true"
              className="hidden shrink-0 rounded-md bg-overlay-6 px-2 py-0.5 font-mono text-[11px] text-text-muted @min-[520px]/protected:inline"
            >
              ••••••••••••
            </span>
          )}
        </div>

        {editing && (
          <div className="space-y-2 border-t border-border px-3 py-3">
            {embedded && (
              <label htmlFor={inputId} className="text-xs text-muted-foreground">{title}</label>
            )}
            {kind === "credential-file" ? (
              <>
                <textarea
                  id={inputId}
                  rows={4}
                  value={draft}
                  disabled={locked}
                  spellCheck={false}
                  aria-describedby={describedBy}
                  placeholder={status.configured ? "Paste replacement credential JSON" : placeholder}
                  className="min-h-20 w-full resize-y rounded-md border border-input bg-transparent px-2 py-1.5 font-mono text-xs text-foreground outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring-a50 disabled:opacity-50"
                  onChange={(event) => {
                    setDraft(event.target.value)
                    setError(null)
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape" && status.configured) {
                      event.preventDefault()
                      closeEditor()
                    }
                  }}
                />
                <div className="flex min-w-0 flex-col items-stretch gap-1.5">
                  <input
                    type="file"
                    accept={fileAccept}
                    disabled={locked}
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
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Input
                  id={inputId}
                  type={reveal ? "text" : "password"}
                  value={draft}
                  disabled={locked}
                  autoComplete={autoComplete}
                  spellCheck={false}
                  aria-describedby={describedBy}
                  placeholder={status.configured ? "Enter a replacement" : placeholder}
                  className="h-8 flex-1 font-mono text-xs"
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && draft) {
                      event.preventDefault()
                      void replace()
                    }
                    if (event.key === "Escape" && status.configured) {
                      event.preventDefault()
                      closeEditor()
                    }
                  }}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  disabled={locked || !draft}
                  aria-label={reveal ? "Hide newly entered value" : "Show newly entered value"}
                  onClick={() => setReveal((value) => !value)}
                >
                  <Icon name={reveal ? "ph-bold ph-eye-slash" : "ph-bold ph-eye"} aria-hidden="true" />
                  {reveal ? "Hide" : "Show"}
                </Button>
              </div>
            )}
            {status.configured && (
              <p className="text-[11px] text-muted-foreground">The current value keeps working until you save.</p>
            )}
          </div>
        )}

        {revealedValue && !editing && (
          <div ref={revealedRef} data-slot="protected-value-revealed" className="space-y-2 border-t border-border px-3 py-3">
            <div className="flex items-center gap-2">
              <Input
                ref={revealedValueRef}
                data-slot="protected-value-revealed-value"
                readOnly
                value={revealedValue}
                spellCheck={false}
                aria-label={revealedLabel}
                aria-describedby={revealedNoticeId}
                className="h-8 flex-1 font-mono text-xs"
                onFocus={(event) => event.currentTarget.select()}
              />
              <Button
                type="button"
                variant="outline"
                size="xs"
                data-slot="protected-value-copy"
                onClick={() => void copyRevealedValue()}
              >
                <Icon name={copyState === "copied" ? "ph-bold ph-check" : "ph-bold ph-copy"} aria-hidden="true" />
                {copyState === "copied" ? "Copied" : "Copy"}
              </Button>
            </div>
            <p id={revealedNoticeId} className="flex items-center gap-1 text-[11px] text-muted-foreground" role="status">
              <Icon name="ph-bold ph-eye-slash" className="shrink-0 text-[11px]" aria-hidden="true" />
              {copyState === "failed"
                ? "Copy is blocked here. The value is selected; copy it manually."
                : revealedValueNotice}
            </p>
          </div>
        )}

        {editing ? (
          <div className="flex items-center justify-end gap-1.5 border-t border-border px-2 py-1.5">
            {status.configured && (
              <Button type="button" variant="ghost" size="xs" disabled={locked} onClick={closeEditor}>
                Cancel
              </Button>
            )}
            <Button type="button" size="xs" disabled={locked || !draft} onClick={() => void replace()}>
              {busy === "save" ? "Saving..." : "Save"}
            </Button>
          </div>
        ) : allowClear && onClear && confirmClear ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border bg-destructive-a10 px-3 py-2">
            <div className="mr-auto min-w-0 flex-1 basis-40 text-xs">
              <p className="font-medium text-foreground">Remove {removeLabel ?? title}?</p>
              {removeNotice && <p className="mt-0.5 text-muted-foreground">{removeNotice}</p>}
            </div>
            <Button type="button" variant="ghost" size="xs" disabled={busy !== null}
              onClick={() => setConfirmClear(false)}>Keep</Button>
            <Button type="button" variant="destructive" size="xs" disabled={busy !== null}
              onClick={() => void clear()}>{busy === "clear" ? "Removing..." : "Remove"}</Button>
          </div>
        ) : showRail ? (
          <div className="flex min-w-0 flex-wrap items-center gap-1 border-t border-border px-2 py-1.5">
            {canVerify && onVerify && (
              <Button type="button" variant="ghost" size="xs" disabled={locked} onClick={() => void verify()}>
                <Icon name="ph-bold ph-seal-check" aria-hidden="true" />
                {busy === "verify" ? "Checking..." : "Verify"}
              </Button>
            )}
            {onRotate ? (
              <Button type="button" variant="ghost" size="xs" disabled={locked} onClick={() => void rotate()}>
                <Icon name="ph-bold ph-arrows-clockwise" aria-hidden="true" />
                {busy === "rotate" ? "Rotating..." : "Rotate"}
              </Button>
            ) : replaceable && onReplace ? (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={locked}
                onClick={() => {
                  setConfirmClear(false)
                  setEditing(true)
                }}
              >
                <Icon name="ph-bold ph-pencil-simple" aria-hidden="true" />
                Replace
              </Button>
            ) : null}
            <span className="flex-1" />
            {allowClear && onClear && (
              <Button
                type="button"
                variant="ghost"
                size="xs"
                disabled={locked}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmClear(true)}
              >
                <Icon name="ph-bold ph-trash" aria-hidden="true" />
                Remove
              </Button>
            )}
          </div>
        ) : null}
      </div>

      {description && <p id={descriptionId} className="text-xs text-muted-foreground">{description}</p>}
      {error && <p id={errorId} className="text-xs text-destructive" role="alert">{error}</p>}
    </div>
  )
}

const defaultLabels: Record<ProtectedValueKind, string> = {
  secret: "Secret",
  password: "Password",
  token: "Token",
  "credential-file": "Credential file",
}

function protectionPresentation(protection: ProtectedValueProtection, configured: boolean): {
  summary: string
  icon: string
  tone: "secure" | "warning" | "danger"
} {
  if (!configured) return { summary: "Nothing saved yet", icon: "ph-bold ph-lock-simple-open", tone: "warning" }
  switch (protection) {
    case "hashed":
      return { summary: "Password is set · one-way hash", icon: "ph-bold ph-lock-simple", tone: "secure" }
    case "pending":
      return { summary: "Ready to apply · not stored yet", icon: "ph-bold ph-warning", tone: "warning" }
    case "legacy":
      return { summary: "Saved value needs protection · legacy storage", icon: "ph-bold ph-warning", tone: "warning" }
    case "unavailable":
      return { summary: "Secure storage unavailable · not protected", icon: "ph-bold ph-warning", tone: "danger" }
    case "unknown":
      return { summary: "Storage status unavailable", icon: "ph-bold ph-warning", tone: "warning" }
    default:
      return { summary: "Encrypted on this machine", icon: "ph-bold ph-lock-simple", tone: "secure" }
  }
}

/** "today, 14:41", "23 Nov", or "23 Nov 2025"; empty or unparsable input yields null. */
function formatStamp(value?: string | null): string | null {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  if (date.toDateString() === now.toDateString()) {
    return `today, ${date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
  }
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
  })
}
