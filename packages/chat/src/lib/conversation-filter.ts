import type { MessageBlock, ConversationEntry } from "../types"

const MAX_ENTRIES = 6
const MAX_CHARS = 200

export function filterConversation(messages: MessageBlock[]): ConversationEntry[] {
  const textOnly: ConversationEntry[] = []

  for (const block of messages) {
    const parts: string[] = []
    for (const part of block.parts) {
      if (part.type === "text" && part.content.trim()) parts.push(part.content.trim())
    }
    const content = parts.join("\n")
    if (content) {
      const truncated = content.length > MAX_CHARS ? content.slice(0, MAX_CHARS) + "…" : content
      textOnly.push({ role: block.role, content: truncated })
    }
  }

  return textOnly.slice(-MAX_ENTRIES)
}
