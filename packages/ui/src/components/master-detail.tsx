import { type ReactNode, useState, useEffect, useMemo, useCallback, useRef } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs"
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "./resizable"
import { cn } from "../utils"

interface MasterDetailLayoutProps {
  sidebar: ReactNode
  detail: ReactNode
  /** Desktop sidebar placement. Compact and mobile tab order is unchanged. */
  sidebarPosition?: "left" | "right"
  sidebarWidth?: string
  layoutKey?: string
  sidebarDefault?: number
  sidebarMin?: number
  sidebarMax?: number
  mobileLabels?: [string, string]
  mobileTab?: number
  onMobileTabChange?: (tab: number) => void
  header?: ReactNode
  className?: string
  /** Force compact tabbed presentation for constrained secondary windows. */
  presentation?: "responsive" | "compact"
}

function MasterDetailLayout({
  sidebar,
  detail,
  sidebarWidth = "w-80",
  sidebarPosition = "left",
  layoutKey,
  sidebarDefault = 320,
  sidebarMin = 240,
  sidebarMax = 560,
  mobileLabels = ["List", "Detail"],
  mobileTab: controlledTab,
  onMobileTabChange,
  header,
  className,
  presentation = "responsive",
}: MasterDetailLayoutProps) {
  const [internalTab, setInternalTab] = useState(0)
  const tab = controlledTab ?? internalTab
  const setTab = onMobileTabChange ?? setInternalTab

  const [isDesktop, setIsDesktop] = useState(() =>
    presentation === "compact" ? false : typeof window !== "undefined"
      ? window.matchMedia("(min-width: 768px)").matches
      : true,
  )

  useEffect(() => {
    if (presentation === "compact") {
      setIsDesktop(false)
      return
    }
    const mql = window.matchMedia("(min-width: 768px)")
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches)
    mql.addEventListener("change", handler)
    return () => mql.removeEventListener("change", handler)
  }, [presentation])

  const savedSidebarSize = useMemo(() => {
    if (!layoutKey) return undefined
    try {
      const raw = localStorage.getItem(layoutKey)
      if (!raw) return undefined
      const saved = JSON.parse(raw) as { version?: number; sidebarPixels?: number }
      return saved.version === 2 && Number.isFinite(saved.sidebarPixels)
        ? saved.sidebarPixels
        : undefined
    } catch {
      return undefined
    }
  }, [layoutKey])

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingSidebarSize = useRef<number | null>(null)

  const persistSidebarSize = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = null
    if (!layoutKey || pendingSidebarSize.current === null) return
    try {
      localStorage.setItem(
        layoutKey,
        JSON.stringify({ version: 2, sidebarPixels: Math.round(pendingSidebarSize.current) }),
      )
    } catch { /* ignore */ }
    pendingSidebarSize.current = null
  }, [layoutKey])

  const handleSidebarResize = useCallback(
    (size: { inPixels: number }) => {
      if (!layoutKey) return
      pendingSidebarSize.current = size.inPixels
      if (saveTimer.current) clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(persistSidebarSize, 300)
    },
    [layoutKey, persistSidebarSize],
  )

  useEffect(() => () => persistSidebarSize(), [persistSidebarSize])

  const resizable = !!layoutKey

  const sidebarPanel = resizable ? (
    <ResizablePanel
      key="sidebar"
      id="sidebar"
      defaultSize={savedSidebarSize ?? sidebarDefault}
      minSize={sidebarMin}
      maxSize={sidebarMax}
      groupResizeBehavior="preserve-pixel-size"
      onResize={handleSidebarResize}
    >
      <div
        data-slot="master-detail-sidebar"
        className="h-full bg-surface-elevated flex flex-col overflow-hidden"
      >
        {sidebar}
      </div>
    </ResizablePanel>
  ) : (
    <div
      key="sidebar"
      data-slot="master-detail-sidebar"
      className={cn(
        sidebarWidth,
        sidebarPosition === "left" ? "border-r" : "border-l",
        "shrink-0 bg-surface-elevated border-overlay-6 flex flex-col overflow-hidden",
      )}
    >
      {sidebar}
    </div>
  )

  const detailPanel = resizable ? (
    <ResizablePanel key="content" id="content" groupResizeBehavior="preserve-relative-size">
      <div
        data-slot="master-detail-content"
        className="h-full overflow-hidden flex flex-col min-h-0"
      >
        {detail}
      </div>
    </ResizablePanel>
  ) : (
    <div
      key="content"
      data-slot="master-detail-content"
      className="flex-1 overflow-hidden flex flex-col min-h-0"
    >
      {detail}
    </div>
  )

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
          >
            {sidebarPosition === "left" ? sidebarPanel : detailPanel}
            <ResizableHandle withHandle aria-label="Resize sidebar" />
            {sidebarPosition === "left" ? detailPanel : sidebarPanel}
          </ResizablePanelGroup>
        ) : (
          <div className="flex flex-1 min-h-0">
            {sidebarPosition === "left" ? sidebarPanel : detailPanel}
            {sidebarPosition === "left" ? detailPanel : sidebarPanel}
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
