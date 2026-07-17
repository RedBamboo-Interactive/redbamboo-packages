import type { ReactNode } from "react"

/**
 * One labeled row in a settings section: label left, control right, optional
 * hint underneath. Shared by the kernel Settings panel and plugin-contributed
 * settings tabs so both render with the same rhythm.
 */
export function SettingRow({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div data-slot="setting-row" className="py-2.5">
      <div className="flex items-center justify-between gap-4">
        <span className="text-sm text-text-muted">{label}</span>
        {children}
      </div>
      {hint && (
        <p className="text-xs text-muted-a60 mt-1 leading-relaxed">{hint}</p>
      )}
    </div>
  )
}

/** Uppercase group heading above a run of SettingRows. */
export function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="section-header"
      className="text-[11px] font-medium text-text-muted uppercase tracking-wider mb-3"
    >
      {children}
    </div>
  )
}
