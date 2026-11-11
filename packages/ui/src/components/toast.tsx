import * as React from "react"
import { createPortal } from "react-dom"
import { cn } from "../utils"
import { useUiEnvironment } from "../ui-environment"
import {
  activeToaster,
  dismissToast,
  getToasts,
  pauseToasts,
  registerToaster,
  resumeToasts,
  subscribeToasts,
  toast,
  updateToast,
  type ToastInput,
  type ToastRecord,
  type ToastUpdate,
  type ToastVariant,
} from "./toast-store"

export type { Toast, ToastAction, ToastInput, ToastOptions, ToastUpdate, ToastVariant } from "./toast-store"
export { dismissToast, toast, updateToast } from "./toast-store"

// One entry point: `toast()` (or `useToast()` inside React) raises a toast on the page's
// single queue. One renderer: the host mounts one <Toaster /> per document; the RedLeaf
// shell's AppShell owns the main page's, a detached window (Float Nova) owns its own.

export interface ToastApi {
  toast: (toast: ToastInput) => string
  update: (id: string, update: ToastUpdate) => void
  dismiss: (id: string) => void
}

/**
 * Raise toasts from a component. Toasts go to the toaster of the document the component
 * renders in, so a detached window shows its own toasts. Works anywhere; no provider needed.
 */
export function useToast(): ToastApi {
  const { document: target } = useUiEnvironment()
  return React.useMemo<ToastApi>(() => ({
    toast: (input) => toast(input, { document: target }),
    update: updateToast,
    dismiss: dismissToast,
  }), [target])
}

/**
 * @deprecated Toasts no longer need a provider: `useToast()` and `toast()` work anywhere and
 * the host's single <Toaster /> renders them. Kept so existing plugin bundles keep working;
 * it renders its children and nothing else.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

// ── Toaster ────────────────────────────────────────────────────────────

const variantIcon: Record<ToastVariant, string> = {
  default: "ph-bold ph-info",
  success: "ph-bold ph-check",
  error: "ph-bold ph-warning",
  loading: "ph-bold ph-spinner animate-spin",
}

const variantColor: Record<ToastVariant, string> = {
  default: "text-primary",
  success: "text-green-500",
  error: "text-destructive",
  loading: "text-primary",
}

/**
 * Renders the toasts of the document it is mounted in, portalled to that document's portal
 * container. Mount exactly one per document; a second one for the same document stays empty.
 */
export function Toaster() {
  const { document: target, portalContainer } = useUiEnvironment()
  const [key] = React.useState(() => Symbol("toaster"))
  React.useEffect(() => registerToaster(target, key), [target, key])

  const all = React.useSyncExternalStore(subscribeToasts, getToasts, getToasts)
  const active = React.useSyncExternalStore(
    subscribeToasts,
    () => activeToaster(target) === key,
    () => false,
  )
  const mine = React.useMemo(() => all.filter((t) => t.target === target), [all, target])

  // The stack unmounts with its last toast, which never fires pointerleave.
  const empty = mine.length === 0
  React.useEffect(() => {
    if (empty) resumeToasts(target)
  }, [empty, target])
  React.useEffect(() => () => resumeToasts(target), [target])

  if (!active || empty) return null

  return createPortal(
    <div
      data-slot="toaster"
      role="region"
      aria-label="Notifications"
      aria-live="polite"
      onPointerEnter={() => pauseToasts(target)}
      onPointerLeave={() => resumeToasts(target)}
      className="fixed bottom-4 left-4 right-4 z-[100] flex flex-col sm:left-auto sm:max-w-sm"
    >
      {mine.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>,
    portalContainer,
  )
}

function ToastItem({ toast: t }: { toast: ToastRecord }) {
  // Entering until the arrival motion has played; the slot clips its growing height meanwhile.
  const [entering, setEntering] = React.useState(true)

  return (
    <div
      data-slot="toast-slot"
      data-phase={t.phase}
      data-entering={entering ? "" : undefined}
      className="rb-toast-slot"
      onAnimationEnd={(event) => {
        if (event.animationName === "rb-toast-in") setEntering(false)
      }}
    >
      <div className="rb-toast-clip">
        <div className="pt-2">
          <div
            data-slot="toast"
            data-variant={t.variant}
            data-phase={t.phase}
            role={t.variant === "error" ? "alert" : "status"}
            className="rb-toast flex items-start gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-lg shadow-black/20"
          >
            <i className={cn(variantIcon[t.variant], variantColor[t.variant], "mt-0.5 text-sm")} aria-hidden />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-foreground">{t.title}</p>
              {t.description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
              )}
              {t.action && (
                <button
                  type="button"
                  onClick={t.action.onClick}
                  className="mt-1.5 text-xs font-medium text-primary hover:underline"
                >
                  {t.action.label}
                </button>
              )}
            </div>
            <button
              type="button"
              aria-label="Dismiss"
              data-slot="toast-dismiss"
              onClick={() => dismissToast(t.id)}
              className="text-muted-foreground hover:text-foreground transition-colors text-xs p-0.5"
            >
              <i className="ph-bold ph-x" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
