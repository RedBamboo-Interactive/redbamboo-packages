import { useCommand } from "@redbamboo/utility"
import {
  CONVERSATION_SHORTCUTS,
  conversationCommandSpecs,
  type ConversationCommandOptions,
  type ConversationShortcutsOptions,
} from "../lib/conversation-commands.ts"

export type { ConversationCommandOptions, ConversationShortcutsOptions }

function useConversationCommand(
  id: string,
  spec: ReturnType<typeof conversationCommandSpecs>[number],
) {
  useCommand(id, {
    label: spec.label,
    description: spec.description,
    group: spec.group,
    shortcut: spec.shortcut,
    keywords: spec.keywords,
    enabled: spec.enabled,
    action: spec.action,
  })
}

/**
 * Registers the open conversation's standard shortcuts (Info, Artifacts, Rename, Update title,
 * Share, Close) as commands, with the keys the menus advertise. A command the host does not pass
 * stays registered but disabled, so the hook calls the same hooks on every render. Host-only
 * commands (Nova's Voice, Reset timeline) are registered by the host beside it.
 *
 * Must render inside the shell's CommandProvider.
 */
export function useConversationShortcuts(options: ConversationShortcutsOptions): void {
  const specs = conversationCommandSpecs(options)
  // Fixed order and count: one useCommand per standard action.
  useConversationCommand(specs[0]!.id, specs[0]!)
  useConversationCommand(specs[1]!.id, specs[1]!)
  useConversationCommand(specs[2]!.id, specs[2]!)
  useConversationCommand(specs[3]!.id, specs[3]!)
  useConversationCommand(specs[4]!.id, specs[4]!)
  useConversationCommand(specs[5]!.id, specs[5]!)
}

export { CONVERSATION_SHORTCUTS }
