import type { MessageBlock, MessagePart } from "../types"

export interface PersistedMessage {
  id: number | string
  role: string
  eventType: string
  content?: string | null
  toolName?: string | null
  toolInput?: string | null
  toolResult?: string | null
  messageId?: string | null
  timestamp: string
  attachmentsJson?: string | null
}

export function rebuildBlocks(records: PersistedMessage[]): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let currentBlock: MessageBlock | null = null

  for (const rec of records) {
    if (rec.role === "user") {
      currentBlock = null
      const part: MessagePart = { type: "text", content: rec.content || "" }
      if (rec.attachmentsJson) {
        try {
          const attachments = JSON.parse(rec.attachmentsJson)
          if (Array.isArray(attachments.images) && attachments.images.length > 0) {
            part.images = attachments.images
          }
        } catch { /* ignore parse errors */ }
      }
      blocks.push({
        id: `db-${rec.id}`,
        role: "user",
        parts: [part],
        timestamp: rec.timestamp,
      })
      continue
    }

    if (!currentBlock || currentBlock.role !== "assistant") {
      currentBlock = {
        id: `db-${rec.id}`,
        role: "assistant",
        parts: [],
        timestamp: rec.timestamp,
      }
      blocks.push(currentBlock)
    }

    if (rec.eventType === "status") continue

    const part: MessagePart = {
      type: rec.eventType as MessagePart["type"],
      content: rec.content || rec.toolResult || "",
      toolName: rec.toolName ?? undefined,
      toolInput: rec.toolInput ?? undefined,
    }

    if (rec.eventType === "text" && currentBlock.parts.length > 0) {
      const last = currentBlock.parts[currentBlock.parts.length - 1]
      if (last.type === "text") {
        last.content += rec.content || ""
        continue
      }
    }

    if (rec.eventType === "thinking" && currentBlock.parts.length > 0) {
      const last = currentBlock.parts[currentBlock.parts.length - 1]
      if (last.type === "thinking") {
        last.content += rec.content || ""
        continue
      }
    }

    currentBlock.parts.push(part)

    if (rec.attachmentsJson) {
      try {
        const attachments = JSON.parse(rec.attachmentsJson)
        if (attachments.audioUrl)
          currentBlock.parts.push({ type: "audio", content: attachments.audioUrl })
        if (Array.isArray(attachments.images) && attachments.images.length > 0) {
          part.images = attachments.images
        }
      } catch { /* ignore parse errors */ }
    }
  }

  return blocks
}
