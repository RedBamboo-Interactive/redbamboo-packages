import type { ComponentProps } from "react"
import { ActionMenuItems, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, type ContextMenuEntry } from "@redbamboo/ui"

export interface ConversationActionsMenuProps {
  /** Built by {@link conversationActionEntries} (or a host adapter over it) with `showShortcuts`. */
  entries: ContextMenuEntry[]
  /** Typed from the trigger itself, so it matches the menu library's React types. */
  triggerRef?: ComponentProps<typeof DropdownMenuTrigger>["ref"]
}

/**
 * The chat header's ⋮ menu. Row, context and long-press menus render the same entries array, so
 * the header and the list cannot drift.
 */
export function ConversationActionsMenu({ entries, triggerRef }: ConversationActionsMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        ref={triggerRef}
        className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-overlay-10 hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-a50"
        aria-label="Conversation actions"
        title="Conversation actions"
      >
        <i aria-hidden="true" className="ph-bold ph-dots-three-vertical text-base" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" sideOffset={4}>
        <ActionMenuItems entries={entries} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
