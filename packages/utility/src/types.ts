import type { ComponentType } from "react"

export interface Command {
  id: string
  label: string
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
