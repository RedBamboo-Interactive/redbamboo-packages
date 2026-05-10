import type { MessageBlock, ConversationEntry } from "../types"

export function filterConversation(messages: MessageBlock[]): ConversationEntry[] {
  const result: ConversationEntry[] = []

  for (const block of messages) {
    const parts: string[] = []

    for (const part of block.parts) {
      switch (part.type) {
        case "text":
          if (part.content.trim()) parts.push(part.content.trim())
          break
        case "tool_use":
          if (part.toolName) parts.push(`[Used tool: ${part.toolName}]`)
          break
        case "error":
          if (part.content.trim()) parts.push(`[Error: ${part.content.trim()}]`)
          break
      }
    }

    const content = parts.join("\n")
    if (content) {
      result.push({ role: block.role, content })
    }
  }

  return result
}
