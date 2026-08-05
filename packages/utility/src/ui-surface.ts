import { useSyncExternalStore } from "react"

export type UiSurfaceState = "unsupported" | "closed" | "opening" | "open" | "closing" | "error"

export interface UiSurfaceActionError {
  code: string
  message: string
  selector?: string
  commandId?: string
  shortcut?: string
}

export interface UiSurfaceActionResult {
  ok: boolean
  state: UiSurfaceState
  error?: UiSurfaceActionError
}

export interface UiSurfaceSnapshot {
  id: string
  owner: string
  name: string
  description: string
  kind: string
  supported: boolean
  unavailableReason?: string
  state: UiSurfaceState
  requiresUserActivation: boolean
  commandId?: string
  shortcut?: string
  selector?: string
  actions: readonly string[]
  selectedResource?: { type: string; id: string } | null
}

export interface UiSurfaceRegistration {
  getSnapshot(): UiSurfaceSnapshot
  runAction(action: string, args?: Readonly<Record<string, unknown>>): UiSurfaceActionResult | Promise<UiSurfaceActionResult>
}

type Listener = () => void

const registrations = new Map<string, UiSurfaceRegistration>()
const listeners = new Set<Listener>()
let snapshot: UiSurfaceSnapshot[] = []

function syncMirror() {
  snapshot = Array.from(registrations.values(), (registration) => registration.getSnapshot())
  if (typeof window === "undefined") return
  const machineWindow = window as unknown as Record<string, unknown>
  machineWindow.__redbamboo_surfaces = snapshot
}

function notify() {
  syncMirror()
  for (const listener of listeners) listener()
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("redbamboo:ui-surface-changed", { detail: snapshot }))
  }
}

export function registerUiSurface(id: string, registration: UiSurfaceRegistration): () => void {
  registrations.set(id, registration)
  notify()
  return () => {
    if (registrations.get(id) !== registration) return
    registrations.delete(id)
    notify()
  }
}

export function notifyUiSurfaceChanged(id: string): void {
  if (registrations.has(id)) notify()
}

export function listUiSurfaces(): UiSurfaceSnapshot[] {
  return snapshot
}

export function getUiSurface(id: string): UiSurfaceSnapshot | undefined {
  return registrations.get(id)?.getSnapshot()
}

export async function runUiSurfaceAction(
  id: string,
  action: string,
  args?: Readonly<Record<string, unknown>>,
): Promise<UiSurfaceActionResult> {
  const registration = registrations.get(id)
  if (!registration) {
    return {
      ok: false,
      state: "unsupported",
      error: { code: "surface_not_registered", message: `UI surface '${id}' is not registered in this client.` },
    }
  }
  return registration.runAction(action, args)
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): UiSurfaceSnapshot[] {
  return snapshot
}

export function useUiSurfaces(): UiSurfaceSnapshot[] {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useUiSurface(id: string): UiSurfaceSnapshot | undefined {
  const surfaces = useUiSurfaces()
  return surfaces.find((surface) => surface.id === id)
}

if (typeof window !== "undefined") {
  const machineWindow = window as unknown as Record<string, unknown>
  machineWindow.__redbamboo_runSurfaceAction = runUiSurfaceAction
  syncMirror()
}
