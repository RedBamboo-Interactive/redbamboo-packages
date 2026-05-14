import { Fragment, type ReactNode } from "react"
import { ScrollArea } from "./scroll-area"
import { cn } from "../utils"

interface ItemListRowProps {
  selected?: boolean
  icon?: ReactNode
  title: string
  subtitle?: ReactNode
  badge?: ReactNode
  trailing?: ReactNode
  onClick?: () => void
  className?: string
}

function ItemListRow({
  selected,
  icon,
  title,
  subtitle,
  badge,
  trailing,
  onClick,
  className,
}: ItemListRowProps) {
  return (
    <button
      data-slot="item-list-row"
      data-selected={selected || undefined}
      onClick={onClick}
      className={cn(
        "group/row flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-contrast/[0.06]",
        selected ? "bg-contrast/[0.08]" : "hover:bg-contrast/[0.04]",
        className,
      )}
    >
      {icon && (
        <div
          data-slot="item-list-icon"
          className="w-8 h-8 rounded-lg bg-surface-base flex items-center justify-center shrink-0"
        >
          {icon}
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            data-slot="item-list-title"
            className="text-[13px] font-medium truncate text-contrast"
          >
            {title}
          </span>
          {badge}
        </div>
        {subtitle && (
          <div
            data-slot="item-list-subtitle"
            className="text-[11px] text-text-muted truncate"
          >
            {subtitle}
          </div>
        )}
      </div>
      {trailing && (
        <div data-slot="item-list-trailing">{trailing}</div>
      )}
    </button>
  )
}

interface ItemListProps<T> {
  items: T[]
  renderItem: (item: T) => ReactNode
  keyFn: (item: T) => string
  emptyMessage?: string
  hasMore?: boolean
  loading?: boolean
  onLoadMore?: () => void
  className?: string
}

function ItemList<T>({
  items,
  renderItem,
  keyFn,
  emptyMessage = "No items",
  hasMore,
  loading,
  onLoadMore,
  className,
}: ItemListProps<T>) {
  return (
    <ScrollArea data-slot="item-list" className={cn("h-full", className)}>
      <div className="flex flex-col">
        {items.map((item) => (
          <Fragment key={keyFn(item)}>{renderItem(item)}</Fragment>
        ))}
        {hasMore && (
          <button
            data-slot="item-list-load-more"
            onClick={onLoadMore}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-4 py-3 text-[12px] text-accent-teal hover:text-contrast transition-colors border-b border-contrast/[0.06] hover:bg-contrast/[0.04]"
          >
            {loading ? (
              <i className="fa-solid fa-spinner fa-spin text-xs" />
            ) : (
              <i className="fa-solid fa-chevron-down text-xs" />
            )}
            <span>Load more</span>
          </button>
        )}
        {items.length === 0 && (
          <p
            data-slot="item-list-empty"
            className="text-text-muted text-sm p-4 text-center"
          >
            {emptyMessage}
          </p>
        )}
      </div>
    </ScrollArea>
  )
}

export { ItemList, ItemListRow }
export type { ItemListProps, ItemListRowProps }
