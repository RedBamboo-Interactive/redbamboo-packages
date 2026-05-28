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
}

function NavTab({ active, icon, shortcut, children, className, ...props }: NavTabProps) {
  const label = typeof children === "string" ? children : undefined
  return (
    <button
      className={navTabClass(active ?? false, className)}
      data-command={shortcut && label ? label : undefined}
      data-command-shortcut={shortcut}
      data-command-group={shortcut ? "Navigate" : undefined}
      {...props}
    >
      {icon && <i className={cn(icon, "text-xs")} />}
      {typeof children === "string" ? (
        <span className={icon ? "hidden sm:inline" : undefined}>{children}</span>
      ) : children}
    </button>
  )
}

function navTabClass(active: boolean, className?: string) {
  return cn(
    "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors",
    active
      ? "text-primary bg-primary-a15"
      : "text-text-muted hover:text-contrast hover:bg-overlay-10",
    className,
  )
}

export { NavTabs, NavTab, navTabClass }
export type { NavTabsProps, NavTabProps }
