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
   * The pane's own Back control, rendered first. Unlike `leading`, which is the
   * pane's identity and is hidden when a dock tab names the pane, Back stays in
   * the header row in a tab group too. Omit it when there is nowhere to go back to.
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

/** Wraps the Back control so it keeps the row's spacing; in a tab group it sits at the start, beside the tabs. */
function BackSlot({ back, tab }: { back: ReactNode; tab: boolean }) {
  if (back == null || back === false) return null
  return (
    <div data-slot="panel-header-back" className={cn("flex shrink-0 items-center", tab && "mr-auto")}>
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
      <BackSlot back={back} tab={false} />
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
 * shows one header. In a tab group the tab names the panel, so the identity
 * (`leading`, `title`) is left out and only the header's Back and actions join
 * the row. Other headers in the panel stay in place.
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
      {createPortal(
        header.wrap(
          <>
            <BackSlot back={back} tab={tab} />
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
