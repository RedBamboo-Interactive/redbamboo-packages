import { cva, type VariantProps } from "class-variance-authority"
import type { ReactNode } from "react"
import { cn } from "../utils"

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
  return (
    <div
      data-slot="panel-header"
      className={cn(panelHeaderVariants({ variant }), className)}
    >
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

export { panelHeaderVariants }
