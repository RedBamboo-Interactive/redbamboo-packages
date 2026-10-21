import { ContextMenu as ContextMenuPrimitive } from "@base-ui/react/context-menu"
import { cn } from "../utils"
import { useUiEnvironment } from "../ui-environment"
import { menuPopupClassName } from "./dropdown-menu"

// Right-click and touch long-press menus. Items, groups, labels and separators are the shared
// Menu primitives, so compose them with the DropdownMenu* parts.

function ContextMenu({
  ...props
}: ContextMenuPrimitive.Root.Props) {
  return <ContextMenuPrimitive.Root data-slot="context-menu" {...props} />
}

function ContextMenuTrigger({
  ...props
}: ContextMenuPrimitive.Trigger.Props) {
  return <ContextMenuPrimitive.Trigger data-slot="context-menu-trigger" {...props} />
}

function ContextMenuContent({
  className,
  sideOffset = 4,
  side,
  align,
  ...props
}: ContextMenuPrimitive.Popup.Props & Pick<ContextMenuPrimitive.Positioner.Props, "sideOffset" | "side" | "align">) {
  const environment = useUiEnvironment()
  return (
    <ContextMenuPrimitive.Portal container={environment.portalContainer}>
      <ContextMenuPrimitive.Positioner sideOffset={sideOffset} side={side} align={align} className="z-50">
        <ContextMenuPrimitive.Popup
          data-slot="context-menu-content"
          className={cn(menuPopupClassName, className)}
          {...props}
        />
      </ContextMenuPrimitive.Positioner>
    </ContextMenuPrimitive.Portal>
  )
}

export { ContextMenu, ContextMenuTrigger, ContextMenuContent }
