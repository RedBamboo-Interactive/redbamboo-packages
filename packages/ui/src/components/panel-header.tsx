import { cva, type VariantProps } from "class-variance-authority"
import { useRef, type ReactNode } from "react"
import { cn } from "../utils"
import { useDockHeader } from "./dock/dock"

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
  leading?: ReactNode
  title?: string
  children?: ReactNode
  className?: string
}

export function PanelHeader({
  leading,
  title,
  children,
  variant,
  className,
}: PanelHeaderProps) {
  const ref = useRef<HTMLDivElement>(null)
  // Inside a dock panel, the panel's first header is its drag handle and menu.
  const dock = useDockHeader(ref)
  return (
    <div
      ref={ref}
      data-slot="panel-header"
      className={cn(panelHeaderVariants({ variant }), className)}
      {...dock?.handleProps}
    >
      {leading}
      {title && (
        <span className="text-[14px] font-medium text-contrast flex-1">
          {title}
        </span>
      )}
      {dock?.menu}
      {children}
    </div>
  )
}

export { panelHeaderVariants }
