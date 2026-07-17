import type { MessageBlock } from "../types"

export interface SharePayload {
  version: 1
  title: string | null
  createdAt: string
  messages: ShareMessage[]
  agent?: { name: string }
  app?: string
}

export interface ShareMessage {
  role: "user" | "assistant" | "event"
  content: string
  timestamp: string
  senderName?: string
}

export interface ShareMetadata {
  title?: string | null
  createdAt?: string
  agentName?: string
  app?: string
}

function extractTextContent(block: MessageBlock): string {
  return block.parts
    .filter((p) => p.type === "text" && p.content)
    .map((p) => p.content)
    .join("\n\n")
}

export function buildSharePayload(
  messages: MessageBlock[],
  meta: ShareMetadata,
  resolveAgentName?: (agentId: string) => string | undefined,
): SharePayload {
  const shareMessages: ShareMessage[] = []

  for (const block of messages) {
    const content = extractTextContent(block)
    if (!content.trim()) continue

    const senderName =
      block.role === "assistant" && block.senderAgentId
        ? resolveAgentName?.(block.senderAgentId) ?? meta.agentName
        : block.role === "assistant"
          ? meta.agentName
          : undefined

    shareMessages.push({
      role: block.role,
      content,
      timestamp: block.timestamp,
      senderName,
    })
  }

  return {
    version: 1,
    title: meta.title ?? null,
    createdAt: meta.createdAt ?? new Date().toISOString(),
    messages: shareMessages,
    agent: meta.agentName ? { name: meta.agentName } : undefined,
    app: meta.app,
  }
}
