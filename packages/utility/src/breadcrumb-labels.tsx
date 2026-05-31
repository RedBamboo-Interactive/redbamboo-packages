import { createContext, useContext, useState, useCallback, useEffect } from "react"

interface LabelEntry {
  label: string
  icon?: string
}

interface BreadcrumbLabelContextValue {
  labels: Map<string, LabelEntry>
  setLabel: (path: string, label: string, icon?: string) => void
  removeLabel: (path: string) => void
}

export const BreadcrumbLabelContext = createContext<BreadcrumbLabelContextValue | null>(null)

export function BreadcrumbLabelProvider({ children }: { children: React.ReactNode }) {
  const [labels, setLabels] = useState<Map<string, LabelEntry>>(() => new Map())

  const setLabel = useCallback((path: string, label: string, icon?: string) => {
    setLabels(prev => {
      const existing = prev.get(path)
      if (existing?.label === label && existing?.icon === icon) return prev
      const next = new Map(prev)
      next.set(path, { label, icon })
      return next
    })
  }, [])

  const removeLabel = useCallback((path: string) => {
    setLabels(prev => {
      if (!prev.has(path)) return prev
      const next = new Map(prev)
      next.delete(path)
      return next
    })
  }, [])

  return (
    <BreadcrumbLabelContext.Provider value={{ labels, setLabel, removeLabel }}>
      {children}
    </BreadcrumbLabelContext.Provider>
  )
}

export function useBreadcrumbLabels(): BreadcrumbLabelContextValue {
  const ctx = useContext(BreadcrumbLabelContext)
  if (!ctx) throw new Error("useBreadcrumbLabels requires BreadcrumbLabelProvider")
  return ctx
}

export function useBreadcrumbLabel(path: string | undefined, label: string | undefined, icon?: string): void {
  const { setLabel, removeLabel } = useBreadcrumbLabels()

  useEffect(() => {
    if (!path || !label) return
    setLabel(path, label, icon)
    return () => removeLabel(path)
  }, [path, label, icon, setLabel, removeLabel])
}
