import { useEffect, useState, type ReactNode } from "react"

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

export function KeyCaptureInput({
  value,
  onChange,
  normalizeKey = (key) => key,
}: {
  value: string
  onChange: (key: string) => void
  normalizeKey?: (key: string) => string | null
}) {
  const [listening, setListening] = useState(false)
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    if (!listening) return
    const handler = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === "Escape") {
        setListening(false)
        setInvalid(false)
        return
      }
      const normalized = normalizeKey(event.key)
      if (!normalized) {
        setInvalid(true)
        return
      }
      onChange(normalized)
      setListening(false)
      setInvalid(false)
    }
    window.addEventListener("keydown", handler, true)
    return () => window.removeEventListener("keydown", handler, true)
  }, [listening, normalizeKey, onChange])

  return (
    <button
      type="button"
      onClick={() => { setListening(true); setInvalid(false) }}
      onBlur={() => { setListening(false); setInvalid(false) }}
      className={`bg-overlay-6 border rounded px-2 py-0.5 text-xs outline-none transition-colors min-w-[80px] text-center ${
        invalid
          ? "border-red-500/60 text-red-400"
          : listening
            ? "border-accent-teal-a50 text-accent-teal animate-pulse"
            : "border-overlay-10 hover:border-overlay-20 text-contrast"
      }`}
      aria-label="Push-to-talk key"
    >
      {invalid ? "Unsupported" : listening ? "Press a key…" : value}
    </button>
  )
}
