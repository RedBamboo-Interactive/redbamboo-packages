import { type ReactNode, useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./resizable"
import { cn } from "../utils"

interface MasterDetailLayoutProps {
  sidebar: ReactNode
  detail: ReactNode
  sidebarWidth?: string
  layoutKey?: string
  sidebarDefault?: string
  sidebarMin?: string
  sidebarMax?: string
  mobileLabels?: [string, string]
  mobileTab?: number
  onMobileTabChange?: (tab: number) => void
  header?: ReactNode
  className?: string
}

function MasterDetailLayout({
  sidebar,
  detail,
  sidebarWidth = "w-80",
  layoutKey,
  sidebarDefault = "18%",
  sidebarMin = "12%",
  sidebarMax = "35%",
  mobileLabels = ["List", "Detail"],
  mobileTab: controlledTab,
  onMobileTabChange,
  header,
  className,
}: MasterDetailLayoutProps) {
  const [internalTab, setInternalTab] = useState(0)
  const tab = controlledTab ?? internalTab
  const setTab = onMobileTabChange ?? setInternalTab

  const [isDesktop, setIsDesktop] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(min-width: 768px)").matches
      : true,
  )

  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)")
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [])

  const savedLayout = useMemo(() => {
    if (!layoutKey) return undefined
    try {
      const raw = localStorage.getItem(layoutKey)
      return raw ? JSON.parse(raw) : undefined
    } catch {
      return undefined
    }
  }, [layoutKey])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleLayoutChanged = useCallback(
    (layout: Record<string, number>) => {
      if (!layoutKey) return
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        try {
          localStorage.setItem(layoutKey, JSON.stringify(layout))
        } catch { /* ignore */ }
      }, 300)
    },
    [layoutKey],
  )

  const resizable = !!layoutKey

  return (
    <div
      data-slot="master-detail"
      className={cn("flex flex-col h-full w-full overflow-hidden", className)}
    >
      {header}

      {isDesktop ? (
        resizable ? (
          <ResizablePanelGroup
            orientation="horizontal"
            className="flex-1 min-h-0"
            defaultLayout={savedLayout}
            onLayoutChanged={handleLayoutChanged}
          >
            <ResizablePanel
              id="sidebar"
              defaultSize={sidebarDefault}
              minSize={sidebarMin}
              maxSize={sidebarMax}
            >
              <div
                data-slot="master-detail-sidebar"
                className="h-full bg-surface-elevated flex flex-col overflow-hidden"
              >
                {sidebar}
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="content" defaultSize={`${100 - parseFloat(sidebarDefault)}%`}>
              <div
                data-slot="master-detail-content"
                className="h-full overflow-hidden flex flex-col min-h-0"
              >
                {detail}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        ) : (
          <div className="flex flex-1 min-h-0">
            <div
              data-slot="master-detail-sidebar"
              className={cn(
                sidebarWidth,
                "shrink-0 bg-surface-elevated border-r border-contrast/[0.06] flex flex-col overflow-hidden",
              )}
            >
              {sidebar}
            </div>
            <div
              data-slot="master-detail-content"
              className="flex-1 overflow-hidden flex flex-col min-h-0"
            >
              {detail}
            </div>
          </div>
        )
      ) : (
        <Tabs
          value={tab}
          onValueChange={(v) => setTab(v as number)}
          className="flex-1 min-w-0 min-h-0 p-3 overflow-hidden"
        >
          <TabsList className="w-full">
            <TabsTrigger value={0}>{mobileLabels[0]}</TabsTrigger>
            <TabsTrigger value={1}>{mobileLabels[1]}</TabsTrigger>
          </TabsList>
          <TabsContent
            value={0}
            className="min-w-0 min-h-0 overflow-hidden flex flex-col"
          >
            <div className="bg-surface-elevated rounded-lg overflow-hidden flex flex-col flex-1 min-h-0">
              {sidebar}
            </div>
          </TabsContent>
          <TabsContent
            value={1}
            className="min-w-0 min-h-0 overflow-hidden flex flex-col"
          >
            {detail}
          </TabsContent>
        </Tabs>
      )}
    </div>
  )
}

export { MasterDetailLayout }
export type { MasterDetailLayoutProps }
