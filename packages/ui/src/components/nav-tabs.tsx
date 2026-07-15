import { cn } from "../utils"

interface NavTabsProps {
  children: React.ReactNode
  className?: string
}

function NavTabs({ children, className }: NavTabsProps) {
  return (
    <nav className={cn("flex items-center gap-3", className)}>
      {children}
    </nav>
  )
}

interface NavTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  icon?: string
  shortcut?: string
  /** Override the active-state accent (defaults to var(--color-primary)). */
  accentColor?: string
}

function NavTab({ active, icon, shortcut, accentColor, children, className, style, ...props }: NavTabProps) {
  const label = typeof children === "string" ? children : undefined
  const activeStyle = active && accentColor
    ? { color: accentColor, background: `color-mix(in srgb, ${accentColor} 15%, transparent)`, ...style }
    : style
  return (
    <button
      className={navTabClass(active ?? false, !accentColor, className)}
      style={activeStyle}
      data-command={shortcut && label ? label : undefined}
      data-command-shortcut={shortcut}
      data-command-group={shortcut ? "Navigate" : undefined}
      {...props}
    >
      {icon && <i className={cn(icon, "text-xs")} />}
      {typeof children === "string" ? (
        <span className={icon ? "max-sm:hidden" : undefined}>{children}</span>
      ) : children}
    </button>
  )
}

function navTabClass(active: boolean, useThemeColor: boolean, className?: string) {
  return cn(
    "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors",
    active
      ? useThemeColor ? "text-primary bg-primary-a15" : ""
      : "text-text-muted hover:text-contrast hover:bg-overlay-10",
    className,
  )
}

export { NavTabs, NavTab, navTabClass }
export type { NavTabsProps, NavTabProps }
