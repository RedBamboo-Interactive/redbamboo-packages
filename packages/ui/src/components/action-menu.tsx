import { useEffect, useRef, useSyncExternalStore, type ReactNode, type RefObject } from "react"
import { cn } from "../utils"
import { useUiEnvironment } from "../ui-environment"
import {
  createContextMenuRunContext,
  getContextMenuConfig,
  isContextMenuSeparator,
  normalizeContextMenuEntries,
  registerContextTarget,
  subscribeContextMenuConfig,
  type ContextMenuConfig,
  type ContextMenuEntries,
  type ContextMenuEntry,
  type ContextMenuItem,
  type ContextMenuRunContext,
} from "../context-menu-core"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "./dropdown-menu"

export function useContextMenuConfig(): ContextMenuConfig {
  return useSyncExternalStore(subscribeContextMenuConfig, getContextMenuConfig, getContextMenuConfig)
}

/** The user's "Leaf context menu" preference, as configured by the shell. */
export function useContextMenuEnabled(): boolean {
  return useContextMenuConfig().enabled
}

/**
 * Registers an element's context-menu items. Inert while the Leaf context menu
 * is off. Pass `kind` (and `subject`) to let other plugins contribute.
 */
export function useContextTarget(
  ref: RefObject<Element | null>,
  /** Return null to decline, letting an ancestor's menu show (see `ContextMenuRunContext.origin`). */
  getItems: (ctx: ContextMenuRunContext) => ContextMenuEntries | null,
  options: { kind?: string; subject?: unknown } = {},
): void {
  const enabled = useContextMenuEnabled()
  const { portalContainer } = useUiEnvironment()
  const latest = useRef({ getItems, subject: options.subject })
  useEffect(() => {
    latest.current = { getItems, subject: options.subject }
  })
  const kind = options.kind
  useEffect(() => {
    const element = ref.current
    if (!enabled || !element) return
    const registration = {
      getItems: (ctx: ContextMenuRunContext) => latest.current.getItems(ctx),
      kind,
      get subject() { return latest.current.subject },
      portalContainer,
    }
    return registerContextTarget(element, registration)
  }, [enabled, ref, kind, portalContainer])
}

function ItemIcon({ icon }: { icon?: string }) {
  return icon ? <i aria-hidden="true" className={`${icon} size-4`} /> : null
}

function ItemShortcut({ shortcut }: { shortcut?: string }) {
  return shortcut ? <DropdownMenuShortcut className="pl-6">{shortcut}</DropdownMenuShortcut> : null
}

function renderEntries(entries: readonly ContextMenuEntry[], ctx: () => ContextMenuRunContext): ReactNode {
  return entries.map((entry) => {
    if (isContextMenuSeparator(entry)) return <DropdownMenuSeparator key={entry.id} />
    const item: ContextMenuItem = entry
    const run = () => { void item.run?.(ctx()) }
    if (item.children?.length) {
      return (
        <DropdownMenuSub key={item.id}>
          <DropdownMenuSubTrigger disabled={item.disabled} className={item.className} data-menu-item={item.id} {...item.attributes}>
            <ItemIcon icon={item.icon} />
            {item.label}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>{renderEntries(item.children, ctx)}</DropdownMenuSubContent>
        </DropdownMenuSub>
      )
    }
    if (item.checked !== undefined) {
      return (
        <DropdownMenuCheckboxItem
          key={item.id}
          checked={item.checked}
          disabled={item.disabled}
          onCheckedChange={run}
          className={item.className}
          data-menu-item={item.id}
          {...item.attributes}
        >
          {item.label}
          <ItemShortcut shortcut={item.shortcut} />
        </DropdownMenuCheckboxItem>
      )
    }
    return (
      <DropdownMenuItem
        key={item.id}
        variant={item.danger ? "destructive" : "default"}
        disabled={item.disabled}
        onClick={run}
        className={item.className}
        data-menu-item={item.id}
        {...item.attributes}
      >
        <ItemIcon icon={item.icon} />
        {item.label}
        <ItemShortcut shortcut={item.shortcut} />
      </DropdownMenuItem>
    )
  })
}

export interface ActionMenuItemsProps {
  entries: readonly ContextMenuEntry[]
  /** Element the actions apply to; null for a ⋮ menu. */
  target?: Element | null
  /** Element pressed to open a context menu. */
  origin?: Element | null
  surface?: ContextMenuRunContext["surface"]
}

/**
 * Renders item descriptors with the DropdownMenu parts, inside any menu popup.
 * The ⋮ row menu and the Leaf context menu both render through this.
 */
export function ActionMenuItems({ entries, target = null, origin = null, surface = "dropdown" }: ActionMenuItemsProps) {
  const environment = useUiEnvironment()
  const { resolveCommand } = useContextMenuConfig()
  const normalized = normalizeContextMenuEntries(entries, resolveCommand)
  const ctx = () => createContextMenuRunContext({ target, origin, surface, document: environment.document, window: environment.window })
  return <>{renderEntries(normalized, ctx)}</>
}

export interface RowActionsMenuProps {
  /** Accessible name and tooltip of the ⋮ trigger. */
  label: string
  entries?: readonly ContextMenuEntry[]
  /** Extra items after `entries` (legacy JSX items). */
  children?: ReactNode
  triggerClassName?: string
}

/** Row actions trigger: always visible on touch screens, which have no hover.
 *  Only a hover-capable fine pointer hides it until row hover, focus or open;
 *  touch never matches a hiding rule, so stylesheet order cannot hide it there. */
export function RowActionsMenu({ label, entries, children, triggerClassName }: RowActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-all hover:bg-overlay-10 hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-a50 [@media(hover:hover)_and_(pointer:fine)]:opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100",
          triggerClassName,
        )}
        aria-label={label}
        title={label}
      >
        <i aria-hidden="true" className="ph-bold ph-dots-three-vertical text-base" />
      </DropdownMenuTrigger>
      {/* The menu portals out of the DOM row, but React still bubbles its clicks
          to the row button; stop them so an action never also selects the row. */}
      <DropdownMenuContent align="end" sideOffset={4} onClick={(e) => e.stopPropagation()}>
        {entries && <ActionMenuItems entries={entries} />}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
