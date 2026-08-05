import type { ComponentType } from "react"

export interface Command {
  id: string
  label: string
  /** What the command does — used for fuzzy search and machine discovery (AI agents). */
  description: string
  /** App or extension that owns the command. Filled by the nearest command scope. */
  source?: CommandSource
  group?: string
  icon?: ComponentType<{ className?: string }>
  shortcut?: string
  keywords?: string[]
  /** True when the action must run synchronously from a trusted click/key event. */
  requiresUserActivation?: boolean
  /** Stable UI-surface id affected by this command, for machine discovery. */
  targetSurfaceId?: string
  action: () => void | Promise<void>
}

export interface CommandSource {
  id: string
  label: string
  /** Icon class used by the owning app or extension in Settings. */
  icon?: string
  /** Optional accent used by the source badge. */
  color?: string
}

export interface CommandPaletteProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placeholder?: string
}
