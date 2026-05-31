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
    <nav aria-label="Breadcrumb" data-slot="breadcrumb">
      <ol className={cn("flex items-center gap-1.5 text-xs", className)}>
        {items.map((item, i) => (
          <li key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <i className="fa-solid fa-chevron-right text-[8px] text-text-muted opacity-50" />
            )}
            {item.href ? (
              <button
                type="button"
                onClick={() => onNavigate(item.href!)}
                className="text-text-muted hover:text-contrast transition-colors cursor-pointer flex items-center gap-1"
              >
                {item.icon && <i className={cn(item.icon, "text-[10px]")} />}
                {item.label}
              </button>
            ) : (
              <span className="text-text-muted flex items-center gap-1">
                {item.icon && <i className={cn(item.icon, "text-[10px]")} />}
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  )
}
