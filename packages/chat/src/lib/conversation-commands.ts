// Command specs for the open conversation's shortcuts. No runtime imports beyond the descriptor
// module, so node tests load it directly; use-conversation-shortcuts.ts registers them.
import { CONVERSATION_SHORTCUTS, type ConversationShortcutKey } from "./conversation-actions.ts"

export { CONVERSATION_SHORTCUTS }

export interface ConversationCommandOptions {
  action: () => void
  /** Defaults to true. A disabled command is not registered, so its key does nothing. */
  enabled?: boolean
  /** Overrides the wording built from the host's noun. */
  label?: string
  description?: string
  keywords?: string[]
  /** Overrides the id built from the host's prefix (keeps an existing command id stable). */
  id?: string
}

export interface ConversationShortcutsOptions {
  /** Command ids are `${idPrefix}-${action}` unless a command names its own id. */
  idPrefix: string
  /** Palette group, e.g. "Discussions" or "Sessions". */
  group: string
  /** What the host calls a conversation, capitalised: "Discussion", "Session". */
  noun: string
  info?: ConversationCommandOptions
  artifacts?: ConversationCommandOptions
  rename?: ConversationCommandOptions
  updateTitle?: ConversationCommandOptions
  share?: ConversationCommandOptions
  close?: ConversationCommandOptions
}

export interface ConversationCommandSpec {
  key: ConversationShortcutKey
  id: string
  label: string
  description: string
  group: string
  shortcut: string
  keywords?: string[]
  enabled: boolean
  action: () => void
}

const ORDER: ConversationShortcutKey[] = ["info", "artifacts", "rename", "updateTitle", "share", "close"]

const ID_SUFFIX: Record<ConversationShortcutKey, string> = {
  info: "info",
  artifacts: "artifacts",
  rename: "rename",
  updateTitle: "update-title",
  share: "share",
  close: "close",
}

function defaults(key: ConversationShortcutKey, noun: string): Pick<ConversationCommandSpec, "label" | "description" | "keywords"> {
  const lower = noun.toLowerCase()
  switch (key) {
    case "info": return { label: `${noun} Info`, description: `Show the session and model of the open ${lower}` }
    case "artifacts": return {
      label: "Toggle Artifacts",
      description: `Show or hide the media, documents, links and entities of the open ${lower}`,
      keywords: ["images", "media", "files", "links", "gallery"],
    }
    case "rename": return { label: `Rename ${noun}`, description: `Edit the title of the open ${lower}` }
    case "updateTitle": return { label: `Update ${noun} Title`, description: `Regenerate the title of the open ${lower} from its conversation` }
    case "share": return { label: `Share ${noun}`, description: `Create a share link for the open ${lower}` }
    case "close": return { label: `Close ${noun}`, description: `Close the open ${lower}` }
  }
}

const noop = () => {}

/** One spec per standard action, always in the same order and count. */
export function conversationCommandSpecs(options: ConversationShortcutsOptions): ConversationCommandSpec[] {
  return ORDER.map((key) => {
    const command = options[key]
    const wording = defaults(key, options.noun)
    return {
      key,
      id: command?.id ?? `${options.idPrefix}-${ID_SUFFIX[key]}`,
      label: command?.label ?? wording.label,
      description: command?.description ?? wording.description,
      group: options.group,
      shortcut: CONVERSATION_SHORTCUTS[key],
      keywords: command?.keywords ?? wording.keywords,
      enabled: !!command && (command.enabled ?? true),
      action: command?.action ?? noop,
    }
  })
}
