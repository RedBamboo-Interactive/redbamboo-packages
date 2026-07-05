import "./app-header.css"
import { cn } from "@redbamboo/ui"

export interface AppHeaderBrandProps {
  icon: string
  nameParts: [string, string]
  accentClass?: string
  /** Accent as a hex color (e.g. a plugin's color); overrides accentClass. */
  color?: string
  /** Show a small chevron after the name, signalling the brand opens a menu. */
  caret?: boolean
  onClick?: () => void
}

export interface AppHeaderProps {
  brand: AppHeaderBrandProps
  /** Replaces the default brand rendering (e.g. a brand wrapped in an AppMenu trigger). */
  brandSlot?: React.ReactNode
  children?: React.ReactNode
  breadcrumb?: React.ReactNode
  className?: string
  onBrandClick?: () => void
}

function AppHeaderBrand({ icon, nameParts, accentClass = "text-primary", color, caret, onClick }: AppHeaderBrandProps) {
  const allLetters = (nameParts[0] + nameParts[1]).split("")
  const mutedCount = nameParts[0].length

  return (
    <div
      className={cn(
        "app-header-brand flex items-center gap-2 select-none shrink-0",
        color ? undefined : accentClass,
        onClick ? "cursor-pointer" : "cursor-default",
      )}
      style={color ? ({ color } as React.CSSProperties) : undefined}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick() } } : undefined}
    >
      <div className="app-header-brand__icon relative size-6 shrink-0 rounded flex items-center justify-center">
        <div className="app-header-brand__bg absolute inset-0 rounded" />
        <i className={cn(icon, "app-header-brand__i relative z-10 text-xs")} />
      </div>
      <span className="app-header-brand__text text-sm font-semibold">
        {allLetters.map((char, i) => (
          <span
            key={i}
            className={cn(
              "app-header-brand__letter inline-block",
              i < mutedCount ? "text-muted-foreground" : "text-current",
            )}
            style={{ "--letter-i": i } as React.CSSProperties}
          >
            {char}
          </span>
        ))}
      </span>
      {caret && (
        <i aria-hidden className="fa-solid fa-chevron-down text-[9px] opacity-60 shrink-0 text-muted-foreground" />
      )}
    </div>
  )
}

function AppHeader({ brand, brandSlot, children, breadcrumb, className, onBrandClick }: AppHeaderProps) {
  return (
    <header data-slot="app-header" className={cn(
      "shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border-a60",
      className,
    )}>
      {brandSlot ?? <AppHeaderBrand {...brand} onClick={onBrandClick} />}
      {breadcrumb && (
        <div className="app-header-crumbs flex items-center gap-3 min-w-0 overflow-hidden">
          <span className="h-4 w-px bg-border-a60 shrink-0" />
          {breadcrumb}
        </div>
      )}
      <span className="flex-1" />
      {children}
    </header>
  )
}

export { AppHeader, AppHeaderBrand }
