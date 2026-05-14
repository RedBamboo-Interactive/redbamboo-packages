import type { ReactNode } from "react"
import { cn } from "../utils"

interface FilterPillOption {
  value: string
  label?: string
  count?: number
  color?: string
}

interface FilterPillGroupProps {
  label: string
  options: FilterPillOption[]
  value: string | null
  onChange: (value: string | null) => void
  activeColor?: string
  activeTextColor?: string
  className?: string
}

function FilterPillGroup({
  label,
  options,
  value,
  onChange,
  activeColor = "rgba(38,166,154,0.2)",
  activeTextColor = "#26A69A",
  className,
}: FilterPillGroupProps) {
  if (options.length <= 1) return null

  return (
    <div
      data-slot="filter-pill-group"
      className={cn("flex items-center gap-1 overflow-x-auto", className)}
    >
      <span className="text-[10px] text-text-disabled shrink-0">{label}</span>
      {options.map((opt) => {
        const isActive = value === opt.value
        const bg = isActive
          ? opt.color
            ? `${opt.color}33`
            : activeColor
          : "rgba(255,255,255,0.08)"
        const fg = isActive
          ? opt.color || activeTextColor
          : "#ADAEB3"

        return (
          <button
            key={opt.value}
            data-slot="filter-pill"
            data-active={isActive || undefined}
            onClick={() => onChange(isActive ? null : opt.value)}
            className="rounded px-1.5 py-0.5 text-[10px] cursor-pointer transition-colors shrink-0"
            style={{ backgroundColor: bg, color: fg }}
          >
            {opt.label || opt.value}
            {opt.count != null && ` (${opt.count})`}
          </button>
        )
      })}
    </div>
  )
}

interface FilterBarProps {
  search?: string
  onSearch?: (value: string) => void
  placeholder?: string
  children?: ReactNode
  onClear?: () => void
  hasActiveFilters?: boolean
  summary?: ReactNode
  className?: string
}

function FilterBar({
  search,
  onSearch,
  placeholder = "Search...",
  children,
  onClear,
  hasActiveFilters,
  summary,
  className,
}: FilterBarProps) {
  return (
    <div
      data-slot="filter-bar"
      className={cn(
        "flex flex-col border-b border-contrast/[0.06]",
        className,
      )}
    >
      <div className="px-3 pt-2 pb-2 flex flex-col gap-2">
        {hasActiveFilters && onClear && (
          <div className="flex justify-end px-1">
            <button
              onClick={onClear}
              className="text-accent-teal text-[11px] hover:text-contrast transition-colors px-1.5 py-0.5 rounded hover:bg-contrast/10"
            >
              Clear filters
            </button>
          </div>
        )}
        {onSearch != null && (
          <div className="flex items-center gap-1.5 bg-contrast/[0.08] rounded px-2 py-1.5">
            <i className="fa-solid fa-magnifying-glass text-[11px] text-text-disabled" />
            <input
              data-slot="filter-bar-search"
              type="text"
              placeholder={placeholder}
              value={search ?? ""}
              onChange={(e) => onSearch(e.target.value)}
              className="bg-transparent border-none outline-none text-[12px] text-[#DCDDDE] placeholder-text-disabled w-full"
            />
            {search && (
              <button
                onClick={() => onSearch("")}
                className="text-text-disabled hover:text-contrast transition-colors"
              >
                <i className="fa-solid fa-xmark text-[10px]" />
              </button>
            )}
          </div>
        )}
        {children}
      </div>

      {summary && (
        <div className="px-3 pb-2">
          <span className="text-[11px] text-text-disabled">{summary}</span>
        </div>
      )}
    </div>
  )
}

export { FilterBar, FilterPillGroup }
export type { FilterBarProps, FilterPillGroupProps, FilterPillOption }
