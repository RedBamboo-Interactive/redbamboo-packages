// Descriptor builder only (no runtime imports), so node tests load it directly.
import type { ContextMenuEntry } from "@redbamboo/ui"

/**
 * Keyboard shortcuts for the open conversation. One map for every host: the menus advertise these
 * keys and {@link useConversationShortcuts} registers them as commands.
 */
export const CONVERSATION_SHORTCUTS = {
  info: "Alt+I",
  artifacts: "Alt+A",
  rename: "Alt+R",
  updateTitle: "Alt+T",
  share: "Alt+S",
  close: "Alt+W",
} as const

export type ConversationShortcutKey = keyof typeof CONVERSATION_SHORTCUTS

export interface ConversationActionHandlers {
  onInfo: () => void
  /** Opens the Artifacts panel for the conversation. */
  onArtifacts?: () => void
  onRename?: () => void
  onUpdateTitle?: () => void
  updateTitlePending?: boolean
  onShare?: () => void
  /** Stops the session process to free memory; the next send resumes it. */
  onStop?: () => void
  onClose?: () => void
  /** Shortcuts act on the open conversation, so only its menus advertise them. */
  showShortcuts?: boolean
  /**
   * Host entries, each in its fixed slot. `leading` comes before Info, `afterShare` right after
   * Share, `trailing` after Stop and before the Close separator. A host builds them with
   * {@link conversationShortcut} so they follow the same advertising rule.
   */
  leading?: ContextMenuEntry[]
  afterShare?: ContextMenuEntry[]
  trailing?: ContextMenuEntry[]
}

/** The key to show for an entry: only the open conversation's menus advertise shortcuts. */
export function conversationShortcut(keys: string, showShortcuts: boolean | undefined): string | undefined {
  return showShortcuts ? keys : undefined
}

/**
 * The conversation actions shared by a chat header menu, each list row menu and the rows' context
 * and long-press menu: one descriptor array, so the menus cannot drift. Order is fixed: host
 * leading entries, Info, Artifacts, Rename, Update title, Share, host after-Share entries, Stop,
 * host trailing entries, then Close alone after a separator so a one-handed tap cannot mistake it.
 */
export function conversationActionEntries({
  onInfo,
  onArtifacts,
  onRename,
  onUpdateTitle,
  updateTitlePending = false,
  onShare,
  onStop,
  onClose,
  showShortcuts = false,
  leading = [],
  afterShare = [],
  trailing = [],
}: ConversationActionHandlers): ContextMenuEntry[] {
  const shortcut = (keys: string) => conversationShortcut(keys, showShortcuts)
  const entries: ContextMenuEntry[] = [...leading]
  entries.push({ id: "info", label: "Info", icon: "ph-bold ph-info", shortcut: shortcut(CONVERSATION_SHORTCUTS.info), run: () => onInfo() })
  if (onArtifacts) entries.push({ id: "artifacts", label: "Artifacts", icon: "ph-bold ph-squares-four", shortcut: shortcut(CONVERSATION_SHORTCUTS.artifacts), run: () => onArtifacts() })
  if (onRename) entries.push({ id: "rename", label: "Rename", icon: "ph-bold ph-pen", shortcut: shortcut(CONVERSATION_SHORTCUTS.rename), run: () => onRename() })
  if (onUpdateTitle) {
    entries.push({
      id: "update-title",
      label: "Update title",
      icon: updateTitlePending ? "ph-bold ph-spinner-gap animate-spin" : "ph-bold ph-sparkle",
      disabled: updateTitlePending,
      shortcut: shortcut(CONVERSATION_SHORTCUTS.updateTitle),
      run: () => onUpdateTitle(),
      attributes: { "aria-busy": updateTitlePending },
    })
  }
  if (onShare) entries.push({ id: "share", label: "Share", icon: "ph-bold ph-share-network", shortcut: shortcut(CONVERSATION_SHORTCUTS.share), run: () => onShare() })
  entries.push(...afterShare)
  if (onStop) entries.push({ id: "stop", label: "Stop", icon: "ph-bold ph-stop", run: () => onStop() })
  entries.push(...trailing)
  if (onClose) {
    entries.push(
      { id: "close-separator", separator: true },
      { id: "close", label: "Close", icon: "ph-bold ph-x", danger: true, shortcut: shortcut(CONVERSATION_SHORTCUTS.close), run: () => onClose() },
    )
  }
  return entries
}
