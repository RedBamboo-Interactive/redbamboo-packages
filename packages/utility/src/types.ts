import type { ComponentType } from "react"

export interface Command {
  id: string
  label: string
  /** What the command does — used for fuzzy search and machine discovery (AI agents). */
  description?: string
  group?: string
  icon?: ComponentType<{ className?: string }>
  shortcut?: string
  keywords?: string[]
  action: () => void | Promise<void>
}

export interface CommandPaletteProps {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  placeholder?: string
}
