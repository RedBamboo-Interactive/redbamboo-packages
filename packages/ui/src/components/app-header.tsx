import "./app-header.css"
import { cn } from "../utils"

export interface AppHeaderBrandProps {
  icon: string
  nameParts: [string, string]
  accentClass?: string
}

export interface AppHeaderProps {
  brand: AppHeaderBrandProps
  children?: React.ReactNode
  className?: string
}

function AppHeaderBrand({ icon, nameParts, accentClass = "text-primary" }: AppHeaderBrandProps) {
  const allLetters = (nameParts[0] + nameParts[1]).split("")
  const mutedCount = nameParts[0].length

  return (
    <div className={cn("app-header-brand flex items-center gap-2 cursor-default select-none", accentClass)}>
      <div className="app-header-brand__icon relative w-6 h-6 rounded flex items-center justify-center">
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
    </div>
  )
}

function AppHeader({ brand, children, className }: AppHeaderProps) {
  return (
    <header data-slot="app-header" className={cn(
      "shrink-0 flex items-center gap-3 px-4 py-2 border-b border-border/60",
      className,
    )}>
      <AppHeaderBrand {...brand} />
      <span className="flex-1" />
      {children}
    </header>
  )
}

export { AppHeader, AppHeaderBrand }
