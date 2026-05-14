import { type ReactNode, useState, useEffect } from "react"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "./tabs"
import { cn } from "../utils"

interface MasterDetailLayoutProps {
  sidebar: ReactNode
  detail: ReactNode
  sidebarWidth?: string
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

  return (
    <div
      data-slot="master-detail"
      className={cn("flex flex-col h-full w-full overflow-hidden", className)}
    >
      {header}

      {isDesktop ? (
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
