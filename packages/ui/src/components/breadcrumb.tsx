import { cn } from "../utils"

export interface BreadcrumbItem {
  label: string
  icon?: string
  href?: string
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[]
  onNavigate: (href: string) => void
  className?: string
}

export function Breadcrumb({ items, onNavigate, className }: BreadcrumbProps) {
  return (
    <nav aria-label="Breadcrumb" data-slot="breadcrumb" className="min-w-0">
      <ol className={cn("flex items-center gap-1.5 text-xs min-w-0", className)}>
        {items.map((item, i) => (
          <li key={i} className={cn("flex items-center gap-1.5", i === items.length - 1 ? "min-w-0" : "shrink-0")}>
            {i > 0 && (
              <i className="ph-bold ph-caret-right text-[8px] text-text-muted opacity-50" />
            )}
            {item.href ? (
              <button
                type="button"
                onClick={() => onNavigate(item.href!)}
                className="text-text-muted hover:text-contrast transition-colors cursor-pointer flex items-center gap-1 min-w-0"
              >
                {item.icon && <i className={cn(item.icon, "text-[10px] shrink-0")} />}
                <span className="truncate">{item.label}</span>
              </button>
            ) : (
              <span className="text-text-muted flex items-center gap-1 min-w-0">
                {item.icon && <i className={cn(item.icon, "text-[10px] shrink-0")} />}
                <span className="truncate">{item.label}</span>
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
