import {
  Component,
  Suspense,
  type ComponentType,
  type ErrorInfo,
  type ReactNode,
} from "react"
import type { LeafPluginExtensionProps } from "./leaf-plugin"

export interface LeafPluginExtensionRegistration {
  pluginId: string
  extensionId: string
  targetPluginId: string
  slotId: string
  order?: number
  Component: ComponentType<LeafPluginExtensionProps>
}

const registrations = new Map<string, LeafPluginExtensionRegistration[]>()

function slotKey(targetPluginId: string, slotId: string): string {
  return `${targetPluginId}:${slotId}`
}

/** Register one lazy frontend contribution discovered from plugin.json. */
export function registerPluginExtension(registration: LeafPluginExtensionRegistration): void {
  const key = slotKey(registration.targetPluginId, registration.slotId)
  const current = registrations.get(key) ?? []
  const withoutPrevious = current.filter(
    (entry) => !(entry.pluginId === registration.pluginId && entry.extensionId === registration.extensionId),
  )
  withoutPrevious.push(registration)
  withoutPrevious.sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0)
      || a.pluginId.localeCompare(b.pluginId)
      || a.extensionId.localeCompare(b.extensionId),
  )
  registrations.set(key, withoutPrevious)
}

interface ExtensionBoundaryProps {
  pluginId: string
  extensionId: string
  children: ReactNode
}

interface ExtensionBoundaryState {
  failed: boolean
}

class ExtensionBoundary extends Component<ExtensionBoundaryProps, ExtensionBoundaryState> {
  state: ExtensionBoundaryState = { failed: false }

  static getDerivedStateFromError(): ExtensionBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `Plugin extension '${this.props.pluginId}:${this.props.extensionId}' failed`,
      error,
      info,
    )
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

export interface PluginExtensionSlotProps {
  targetPluginId: string
  slotId: string
  context?: Readonly<Record<string, unknown>>
}

/**
 * Mount all enabled contributions for a host-owned slot. Registrations are
 * populated before the router renders; each remote stays lazy until its slot
 * is actually visible.
 */
export function PluginExtensionSlot({
  targetPluginId,
  slotId,
  context = {},
}: PluginExtensionSlotProps) {
  const entries = registrations.get(slotKey(targetPluginId, slotId)) ?? []
  if (entries.length === 0) return null

  return (
    <>
      {entries.map((entry) => (
        <ExtensionBoundary
          key={`${entry.pluginId}:${entry.extensionId}`}
          pluginId={entry.pluginId}
          extensionId={entry.extensionId}
        >
          <Suspense fallback={null}>
            <entry.Component context={context} />
          </Suspense>
        </ExtensionBoundary>
      ))}
    </>
  )
}
