// The single toast queue of a page.
//
// `@redbamboo/ui` is an import-map singleton in Leaf, so this module, and therefore this
// queue, exists once per browser page: the shell, every plugin and code outside React all
// raise toasts here. Each toast is addressed to a document (the main page or a detached
// window such as Float Nova); exactly one <Toaster> per document renders its toasts.

export type ToastVariant = "default" | "success" | "error" | "loading"

export interface ToastAction {
  label: string
  onClick: () => void
}

export interface Toast {
  id: string
  title: string
  description?: string
  variant: ToastVariant
  /** Milliseconds before the toast leaves on its own. Ignored while `variant` is "loading". */
  duration?: number
  action?: ToastAction
  /**
   * Flood key, typically the source plugin. At most {@link MAX_TOASTS_PER_GROUP} toasts of a
   * group are shown at once; the rest collapse into one "+N more" toast.
   */
  group?: string
  /** Human name of the group for the "+N more from …" toast. Defaults to `group`. */
  groupLabel?: string
}

export type ToastInput = Omit<Toast, "id">

export interface ToastUpdate {
  title?: string
  description?: string
  variant?: ToastVariant
  duration?: number
  action?: ToastAction
}

export type ToastPhase = "open" | "closing"

export interface ToastRecord extends Toast {
  phase: ToastPhase
  /** Document whose toaster shows this toast; null outside a browser. */
  target: Document | null
}

export interface ToastOptions {
  /** Document whose toaster shows the toast. Defaults to the main page. */
  document?: Document | null
}

export const DEFAULT_TOAST_DURATION = 5000
/** Exit motion (slide out, then collapse) before a closing toast leaves the queue. */
export const TOAST_EXIT_MS = 340
export const MAX_TOASTS_PER_GROUP = 3
/** Toasts shown at once per document; the oldest open one leaves to make room. */
export const MAX_VISIBLE_TOASTS = 5

interface Timer {
  handle: ReturnType<typeof setTimeout> | null
  remaining: number
  startedAt: number
}

interface Overflow {
  id: string
  count: number
}

let toasts: readonly ToastRecord[] = []
let toasters: readonly { key: symbol; target: Document | null }[] = []
let idCounter = 0
const listeners = new Set<() => void>()
const lifeTimers = new Map<string, Timer>()
const exitTimers = new Map<string, ReturnType<typeof setTimeout>>()
/** Per document, per group: the "+N more" toast standing in for a group's overflow. */
const overflows = new Map<Document | null, Map<string, Overflow>>()
const overflowIds = new Set<string>()
const paused = new Set<Document | null>()

function defaultTarget(): Document | null {
  return typeof document === "undefined" ? null : document
}

function emit() {
  for (const listener of listeners) listener()
}

function setToasts(next: readonly ToastRecord[]) {
  toasts = next
  emit()
}

function now() {
  return Date.now()
}

// ── Life timers ────────────────────────────────────────────────────────

function clearLife(id: string) {
  const timer = lifeTimers.get(id)
  if (timer?.handle) clearTimeout(timer.handle)
  lifeTimers.delete(id)
}

function armLife(id: string, timer: Timer) {
  timer.startedAt = now()
  timer.handle = setTimeout(() => {
    lifeTimers.delete(id)
    dismissToast(id)
  }, timer.remaining)
}

function scheduleLife(record: ToastRecord) {
  clearLife(record.id)
  if (record.variant === "loading") return
  const timer: Timer = { handle: null, remaining: record.duration ?? DEFAULT_TOAST_DURATION, startedAt: 0 }
  // Paused (pointer on the stack): the timeout starts counting when the pointer leaves.
  lifeTimers.set(record.id, timer)
  if (!paused.has(record.target)) armLife(record.id, timer)
}

// ── Queue operations ───────────────────────────────────────────────────

function openIn(target: Document | null) {
  return toasts.filter((t) => t.target === target && t.phase === "open")
}

function makeRoom(target: Document | null) {
  const open = openIn(target)
  // The newest toast is about to join, so keep MAX_VISIBLE_TOASTS - 1. A loading toast is
  // tracking work in progress and is never pushed out.
  let excess = open.length - (MAX_VISIBLE_TOASTS - 1)
  for (const t of open) {
    if (excess <= 0) break
    if (t.variant === "loading") continue
    dismissToast(t.id)
    excess--
  }
}

function push(record: ToastRecord) {
  makeRoom(record.target)
  setToasts([...toasts, record])
  scheduleLife(record)
}

/** Raise a toast and return its id. Safe to call from anywhere, including outside React. */
export function toast(input: ToastInput, options: ToastOptions = {}): string {
  const target = options.document === undefined ? defaultTarget() : options.document
  const group = input.group

  if (group) {
    const inGroup = openIn(target).filter((t) => t.group === group && !overflowIds.has(t.id))
    if (inGroup.length >= MAX_TOASTS_PER_GROUP) {
      let byGroup = overflows.get(target)
      if (!byGroup) overflows.set(target, (byGroup = new Map()))
      const overflow = byGroup.get(group)
      const label = input.groupLabel ?? group
      if (overflow && toasts.some((t) => t.id === overflow.id && t.phase === "open")) {
        overflow.count++
        updateToast(overflow.id, { title: `+${overflow.count} more from ${label}` })
        return overflow.id
      }
      const id = `toast-${++idCounter}`
      byGroup.set(group, { id, count: 1 })
      overflowIds.add(id)
      push({ id, title: `+1 more from ${label}`, variant: "default", group, groupLabel: label, phase: "open", target })
      return id
    }
  }

  const id = `toast-${++idCounter}`
  push({ ...input, id, phase: "open", target })
  return id
}

/** Change a toast in place. Moving it out of "loading" starts its timeout. */
export function updateToast(id: string, update: ToastUpdate) {
  const current = toasts.find((t) => t.id === id)
  if (!current || current.phase === "closing") return
  const next: ToastRecord = { ...current, ...update }
  setToasts(toasts.map((t) => (t.id === id ? next : t)))
  // A new variant or duration restarts the timeout (a loading toast has none); so does
  // another arrival counted into a "+N more" toast.
  if (update.variant !== undefined || update.duration !== undefined || overflowIds.has(id)) scheduleLife(next)
}

/** Start a toast's exit; it leaves the queue once the exit motion has played. */
export function dismissToast(id: string) {
  const current = toasts.find((t) => t.id === id)
  if (!current || current.phase === "closing") return
  clearLife(id)
  setToasts(toasts.map((t) => (t.id === id ? { ...t, phase: "closing" as const } : t)))
  exitTimers.set(id, setTimeout(() => removeToast(id), TOAST_EXIT_MS))
}

function removeToast(id: string) {
  const exit = exitTimers.get(id)
  if (exit) clearTimeout(exit)
  exitTimers.delete(id)
  clearLife(id)
  if (overflowIds.delete(id)) {
    for (const byGroup of overflows.values()) {
      for (const [group, overflow] of byGroup) if (overflow.id === id) byGroup.delete(group)
    }
  }
  if (toasts.some((t) => t.id === id)) setToasts(toasts.filter((t) => t.id !== id))
}

/** Hold every timeout of a document's toasts, e.g. while the pointer rests on the stack. */
export function pauseToasts(target: Document | null) {
  if (paused.has(target)) return
  paused.add(target)
  const t = now()
  for (const record of toasts) {
    if (record.target !== target) continue
    const timer = lifeTimers.get(record.id)
    if (!timer?.handle) continue
    clearTimeout(timer.handle)
    timer.handle = null
    timer.remaining = Math.max(0, timer.remaining - (t - timer.startedAt))
  }
}

export function resumeToasts(target: Document | null) {
  if (!paused.delete(target)) return
  for (const record of toasts) {
    if (record.target !== target) continue
    const timer = lifeTimers.get(record.id)
    if (timer && !timer.handle) armLife(record.id, timer)
  }
}

// ── Subscription (useSyncExternalStore) ────────────────────────────────

export function subscribeToasts(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getToasts(): readonly ToastRecord[] {
  return toasts
}

// ── Toaster registry: one renderer per document ────────────────────────

/**
 * Register a toaster for a document. The first one registered renders; any further toaster
 * for the same document stays silent, so a stray second mount can never draw a second stack.
 */
export function registerToaster(target: Document | null, key: symbol): () => void {
  toasters = [...toasters, { key, target }]
  if (toasters.filter((t) => t.target === target).length > 1 && typeof console !== "undefined") {
    console.warn("[@redbamboo/ui] A second <Toaster> was mounted for the same document; only the first one renders.")
  }
  emit()
  return () => {
    toasters = toasters.filter((t) => t.key !== key)
    emit()
  }
}

/** The registration key of the toaster that renders for `target`, if any. */
export function activeToaster(target: Document | null): symbol | undefined {
  return toasters.find((t) => t.target === target)?.key
}

/** Test hook: empty the queue and forget every timer, toaster and pause. */
export function resetToastsForTests() {
  for (const timer of lifeTimers.values()) if (timer.handle) clearTimeout(timer.handle)
  for (const handle of exitTimers.values()) clearTimeout(handle)
  lifeTimers.clear()
  exitTimers.clear()
  overflows.clear()
  overflowIds.clear()
  paused.clear()
  toasters = []
  toasts = []
  emit()
}
