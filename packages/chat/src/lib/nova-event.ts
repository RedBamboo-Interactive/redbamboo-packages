export interface NovaEvent {
  source: string
  type: string
  content: string
}

/** Parse Nova's tagged event carrier without exposing the carrier as chat text. */
export function parseNovaEvent(content: string): NovaEvent | null {
  if (!content.includes("<nova-event")) return null
  const match = content.match(/<nova-event\s+([^>]*)>([\s\S]*?)<\/nova-event>/)
  if (!match) return null
  const attrs = match[1]
  return {
    source: attrs.match(/source="([^"]*)"/)?.[1] || "automation",
    type: attrs.match(/type="([^"]*)"/)?.[1] || "generic",
    content: match[2].trim(),
  }
}
