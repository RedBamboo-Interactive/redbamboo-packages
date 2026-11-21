import { cva, type VariantProps } from "class-variance-authority"
import type { ReactNode } from "react"
import { createPortal } from "react-dom"
import { cn } from "../utils"
import { useDockedHeader, useIsInDockPanel } from "./dock/dock"

const panelHeaderVariants = cva(
  "flex items-center gap-2 px-3 border-b border-overlay-6 shrink-0",
  {
    variants: {
      variant: {
        default: "h-12",
        compact: "py-2 flex-wrap",
      },
    },
    defaultVariants: { variant: "default" },
  },
)

export interface PanelHeaderProps
  extends VariantProps<typeof panelHeaderVariants> {
  /**
   * The pane's own Back control, rendered first in the header row. In a dock tab
   * group the shared row belongs to every tab, so Back moves into the pane
   * instead: a compact row at the header's place, `[Back] title`. Omit it when
   * there is nowhere to go back to.
   */
  back?: ReactNode
  leading?: ReactNode
  title?: string
  children?: ReactNode
  className?: string
}

export function PanelHeader(props: PanelHeaderProps) {
  // Inside a dock panel the dock takes the header over; everywhere else
  // (including every narrow and mobile layout) it renders exactly as it always has.
  return useIsInDockPanel() ? <DockedPanelHeader {...props} /> : <StaticPanelHeader {...props} />
}

const hasBack = (back: ReactNode) => back != null && back !== false

/** Wraps the Back control so it keeps the row's spacing. */
function BackSlot({ back }: { back: ReactNode }) {
  if (!hasBack(back)) return null
  return (
    <div data-slot="panel-header-back" className="flex shrink-0 items-center">
      {back}
    </div>
  )
}

function StaticPanelHeader({
  back,
  leading,
  title,
  children,
  variant,
  className,
}: PanelHeaderProps) {
  return (
    <div
      data-slot="panel-header"
      className={cn(panelHeaderVariants({ variant }), className)}
    >
      <BackSlot back={back} />
      {leading}
      {title && (
        <span className="text-[14px] font-medium text-contrast flex-1">
          {title}
        </span>
      )}
      {children}
    </div>
  )
}

/**
 * The panel's first header becomes the dock group's header row: its content
 * moves into that row and the in-place header is hidden, so a docked panel
 * shows one header. In a tab group the tab names the panel, so only the
 * header's actions join the row. A header with Back then keeps a compact row of
 * its own inside the pane, `[Back] title`, so Back stays with the tab it walks
 * and the pane's current title is not lost. Other headers stay in place.
 */
function DockedPanelHeader({
  back,
  leading,
  title,
  children,
  variant,
  className,
}: PanelHeaderProps) {
  const rowClassName = cn(panelHeaderVariants({ variant }), className)
  // The dock's header row takes on these classes, so a docked header keeps its
  // height, padding and spacing.
  const header = useDockedHeader(rowClassName)!
  const tab = header.primary && header.mode === "tab"
  const showIdentity = !tab
  return (
    <>
      <div
        ref={header.containerRef}
        data-slot="panel-header"
        data-dock-taken-over={header.primary ? "" : undefined}
        className={rowClassName}
        style={header.primary ? { display: "none" } : undefined}
      />
      {tab && hasBack(back) ? (
        // Rendered in place: it scrolls, hides and goes inert with its own tab.
        <div
          data-slot="panel-header-back-row"
          className="flex h-9 shrink-0 items-center gap-2 border-b border-overlay-6 px-3"
        >
          <BackSlot back={back} />
          {title ? (
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-contrast">{title}</span>
          ) : leading}
        </div>
      ) : null}
      {createPortal(
        header.wrap(
          <>
            {tab ? null : <BackSlot back={back} />}
            {showIdentity ? leading : null}
            {showIdentity && title ? (
              <span className="text-[14px] font-medium text-contrast flex-1">
                {title}
              </span>
            ) : null}
            {children}
          </>,
        ),
        header.contentHost,
      )}
    </>
  )
}

export { panelHeaderVariants }
