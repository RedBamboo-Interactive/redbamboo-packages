import { Group, Panel, Separator } from "react-resizable-panels"
import { cn } from "../utils"

function ResizablePanelGroup({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof Group>) {
  return (
    <Group
      data-slot="resizable-panel-group"
      orientation={orientation}
      className={cn(
        "flex h-full w-full",
        orientation === "vertical" && "flex-col",
        className,
      )}
      {...props}
    />
  )
}

function ResizablePanel({ ...props }: React.ComponentProps<typeof Panel>) {
  return <Panel data-slot="resizable-panel" {...props} />
}

function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof Separator> & {
  withHandle?: boolean
}) {
  return (
    <Separator
      data-slot="resizable-handle"
      className={cn(
        "group/handle relative flex w-px items-center justify-center bg-contrast/[0.06] after:absolute after:inset-y-0 after:-left-1 after:-right-1 [&[data-resize-handle-active]]:bg-accent-teal/50",
        className,
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-5 w-3 items-center justify-center rounded-sm bg-surface-elevated opacity-0 transition-opacity duration-200 group-hover/handle:opacity-100 group-data-[resize-handle-active]/handle:opacity-100">
          <i className="fa-solid fa-grip-vertical text-[8px] text-text-muted/50" />
        </div>
      )}
    </Separator>
  )
}

export { ResizablePanelGroup, ResizablePanel, ResizableHandle }
