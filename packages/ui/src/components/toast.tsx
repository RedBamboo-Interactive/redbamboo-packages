import * as React from "react"
import { cn } from "../utils"

// ── Types ──────────────────────────────────────────────────────────────

export type ToastVariant = "default" | "success" | "error" | "loading"

export interface Toast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  duration?: number
  action?: { label: string; onClick: () => void }
}

export interface ToastUpdate {
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
  action?: { label: string; onClick: () => void }
}

interface ToastContextValue {
  toast: (toast: Omit<Toast, "id">) => string
  update: (id: string, update: ToastUpdate) => void
  dismiss: (id: string) => void
}

// ── Context ────────────────────────────────────────────────────────────

const ToastContext = React.createContext<ToastContextValue | null>(null)

export function useToast(): ToastContextValue {
  const ctx = React.useContext(ToastContext)
  if (!ctx) throw new Error("useToast must be used within a ToastProvider")
  return ctx
}

// ── Provider & Renderer ────────────────────────────────────────────────

let idCounter = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([])
  const timers = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  function scheduleRemoval(id: string, duration: number) {
    const existing = timers.current.get(id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
      timers.current.delete(id)
    }, duration)
    timers.current.set(id, timer)
  }

  const toast = React.useCallback((t: Omit<Toast, "id">) => {
    const id = `toast-${++idCounter}`
    const newToast: Toast = { ...t, id }
    setToasts((prev) => [...prev, newToast])
    if (t.variant !== "loading") {
      scheduleRemoval(id, t.duration ?? 5000)
    }
    return id
  }, [])

  const update = React.useCallback((id: string, u: ToastUpdate) => {
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...u } : t))
    )
    if (u.variant && u.variant !== "loading") {
      scheduleRemoval(id, u.duration ?? 5000)
    }
  }, [])

  const dismiss = React.useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
    const timer = timers.current.get(id)
    if (timer) {
      clearTimeout(timer)
      timers.current.delete(id)
    }
  }, [])

  React.useEffect(() => {
    return () => {
      timers.current.forEach((timer) => clearTimeout(timer))
    }
  }, [])

  const value = React.useMemo(() => ({ toast, update, dismiss }), [toast, update, dismiss])

  return (
    <ToastContext.Provider value={value}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

// ── Toaster (renders toasts) ───────────────────────────────────────────

const variantIcon: Record<ToastVariant, string> = {
  default: "fa-solid fa-circle-info",
  success: "fa-solid fa-check",
  error: "fa-solid fa-triangle-exclamation",
  loading: "fa-solid fa-spinner fa-spin",
}

const variantColor: Record<ToastVariant, string> = {
  default: "text-primary",
  success: "text-green-500",
  error: "text-destructive",
  loading: "text-primary",
}

function Toaster({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null

  return (
    <div
      data-slot="toaster"
      className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-slot="toast"
          data-variant={t.variant}
          className="flex items-start gap-3 rounded-lg border border-border bg-popover px-4 py-3 shadow-lg shadow-black/20 animate-in slide-in-from-right-full fade-in duration-200"
        >
          <i className={cn(variantIcon[t.variant], variantColor[t.variant], "mt-0.5 text-sm")} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">{t.title}</p>
            {t.description && (
              <p className="mt-0.5 text-xs text-muted-foreground">{t.description}</p>
            )}
            {t.action && (
              <button
                onClick={t.action.onClick}
                className="mt-1.5 text-xs font-medium text-primary hover:underline"
              >
                {t.action.label}
              </button>
            )}
          </div>
          <button
            onClick={() => onDismiss(t.id)}
            className="text-muted-foreground hover:text-foreground transition-colors text-xs p-0.5"
          >
            <i className="fa-solid fa-xmark" />
          </button>
        </div>
      ))}
    </div>
  )
}
