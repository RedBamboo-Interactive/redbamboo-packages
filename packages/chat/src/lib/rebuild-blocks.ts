import type { MessageBlock, MessagePart, MessagePhase, TranscriptPayloadRef } from "../types"

export interface PersistedMessage {
  id: number | string
  role: string
  eventType: string
  content?: string | null
  toolName?: string | null
  toolInput?: string | null
  toolResult?: string | null
  payloadRef?: TranscriptPayloadRef | null
  messageId?: string | null
  /** Provider-neutral message uid (see ChatEvent.messageUid). Used as the
   * block id when present so streamed and reloaded blocks share identity. */
  messageUid?: string | null
  phase?: MessagePhase | null
  timestamp: string
  attachmentsJson?: string | null
}

export function rebuildBlocks(records: PersistedMessage[]): MessageBlock[] {
  const blocks: MessageBlock[] = []
  let currentBlock: MessageBlock | null = null
  let currentTurnUid: string | null = null
  const segmentCounts = new Map<string, number>()

  // Stream payload persistence and ordinary record persistence can complete in
  // a different order. The record timestamp is the chronology; storage ids and
  // response order are not.
  const ordered = records
    .map((record, index) => ({ record, index }))
    .sort((a, b) => {
      const aTime = Date.parse(a.record.timestamp)
      const bTime = Date.parse(b.record.timestamp)
      const delta = (Number.isNaN(aTime) ? 0 : aTime) - (Number.isNaN(bTime) ? 0 : bTime)
      return delta || a.index - b.index
    })
    .map(({ record }) => record)

  for (const rec of ordered) {
    if (rec.role === "user") {
      currentBlock = null
      currentTurnUid = null
      const part: MessagePart = { type: "text", content: rec.content || "" }
      if (rec.attachmentsJson) {
        try {
          const attachments = JSON.parse(rec.attachmentsJson)
          if (Array.isArray(attachments.images) && attachments.images.length > 0) {
            part.images = attachments.images
          }
          if (Array.isArray(attachments.attachments) && attachments.attachments.length > 0) {
            part.attachments = attachments.attachments
          }
        } catch { /* ignore parse errors */ }
      }
      const userBlock: MessageBlock = {
        id: rec.messageUid || `db-${rec.id}`,
        role: "user",
        parts: [part],
        timestamp: rec.timestamp,
      }
      if (rec.content) {
        const ctxMatch = rec.content.match(/<nova-context\s+([^>]*)>/)
        if (ctxMatch) {
          const attrs: Record<string, unknown> = {}
          const re = /(\w+)="([^"]*)"/g
          let m: RegExpExecArray | null
          while ((m = re.exec(ctxMatch[1])) !== null) attrs[m[1]] = m[2]
          if (Object.keys(attrs).length > 0) userBlock.metadata = attrs
        }
      }
      blocks.push(userBlock)
      continue
    }

    if (rec.eventType === "status") continue

    const turnUid = rec.messageUid || null
    if (!currentBlock || currentBlock.role !== "assistant" || (!!turnUid && currentTurnUid !== turnUid)) {
      // Block identity = uid of the run's first record, matching the id the
      // streaming path assigned when this block was first rendered live. One
      // turn may have several chronological segments around ambient events;
      // keep their React identities unique while retaining the canonical uid.
      const segment: number = turnUid ? (segmentCounts.get(turnUid) ?? 0) : 0
      if (turnUid) segmentCounts.set(turnUid, segment + 1)
      currentBlock = {
        id: turnUid
          ? (segment === 0 ? turnUid : `${turnUid}:segment:${segment}`)
          : `db-${rec.id}`,
        role: "assistant",
        parts: [],
        timestamp: rec.timestamp,
        metadata: turnUid ? { messageUid: turnUid } : undefined,
      }
      currentTurnUid = turnUid
      blocks.push(currentBlock)
    }

    const part: MessagePart = {
      type: rec.eventType as MessagePart["type"],
      content: rec.content || rec.toolResult || "",
      toolName: rec.toolName ?? undefined,
      toolInput: rec.toolInput ?? undefined,
      payloadRef: rec.payloadRef ?? undefined,
      phase: rec.phase ?? undefined,
    }

    if (rec.eventType === "text" && currentBlock.parts.length > 0) {
      const last = currentBlock.parts[currentBlock.parts.length - 1]
      if (last.type === "text" && last.phase === part.phase) {
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
        if (Array.isArray(attachments.attachments) && attachments.attachments.length > 0) {
          part.attachments = attachments.attachments
        }
      } catch { /* ignore parse errors */ }
    }
  }

  return blocks
}
