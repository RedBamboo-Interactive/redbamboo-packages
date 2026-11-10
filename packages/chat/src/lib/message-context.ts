/**
 * The context a host injected ahead of a user message, as Message Info shows it. A host that
 * records it puts the exact text on the block's metadata under {@link MESSAGE_CONTEXT_BLOCK_KEY};
 * `null` under that key says the host keeps contexts but has none for this message (it predates
 * recording). Hosts that never record one leave the key out and the dialog says nothing about it.
 */
export const MESSAGE_CONTEXT_BLOCK_KEY = "novaContextBlock"

export type MessageContextSectionKind =
  | "changes"
  | "live-events"
  | "extensions"
  | "reactions"
  | "outfit"
  | "prior-message"
  | "heading"
  | "other"

export interface MessageContextSection {
  kind: MessageContextSectionKind
  title: string
  /** The section's lines exactly as injected (its heading line excluded). */
  lines: string[]
  /** Long or rarely useful sections start folded. */
  collapsed: boolean
}

export interface MessageContextView {
  /** Attributes of the opening context tag. */
  attrs: Record<string, string>
  sections: MessageContextSection[]
  /** The exact text, unchanged. */
  raw: string
}

/** Headings whose following "- " lines belong to them, in the order a context renders them. */
const HEADINGS: { match: (line: string) => boolean; kind: MessageContextSectionKind; title: (line: string) => string }[] = [
  { match: l => l === "Changes since last message:", kind: "changes", title: () => "Changes since last message" },
  { match: l => l === "Recent LIVE events:", kind: "live-events", title: () => "Recent LIVE events" },
  { match: l => l === "Installed extension context:", kind: "extensions", title: () => "Installed extension context" },
  { match: l => l === "Reactions since your last message:", kind: "reactions", title: () => "Reactions since your last message" },
  // Discussion lists and any other "Heading:" line followed by a list.
  { match: l => /^[A-Z][^:]{0,60}:$/.test(l), kind: "heading", title: l => l.slice(0, -1) },
]

const PRIORITY: MessageContextSectionKind[] = ["changes", "live-events", "extensions", "reactions"]

/** A discussion list longer than this starts folded. */
const FOLD_LIST_OVER = 8

const OUTFIT_PARAGRAPH = /^(You're wearing |Wearing: )/
const OUTFIT_CHANGE = /^- Outfit (changed: |removed$)/

/**
 * Splits a stored context into readable sections: the changes, LIVE events, extension context and
 * reactions first, then the other headed lists (folded when long), the outfit (folded), the prior
 * assistant message (folded), and everything else gathered into "Other". Returns null
 * for text that holds no context tag. The split is for reading only; {@link MessageContextView.raw}
 * keeps the exact text.
 */
export function parseMessageContextBlock(text: string): MessageContextView | null {
  const open = /<nova-context(\s[^>]*)?>/.exec(text)
  if (!open) return null
  const close = text.indexOf("</nova-context>", open.index)
  const body = text.slice(open.index + open[0].length, close < 0 ? undefined : close)

  const attrs: Record<string, string> = {}
  for (const m of (open[1] ?? "").matchAll(/([\w-]+)="([^"]*)"/g)) attrs[m[1]] = decodeAttribute(m[2])

  const named: MessageContextSection[] = []
  const outfit: string[] = []
  const other: string[] = []
  let current: MessageContextSection | null = null

  const paragraphs = body.split(/\n\s*\n/)
  for (const paragraph of paragraphs) {
    current = null
    const lines = paragraph.split("\n").map(l => l.trimEnd()).filter(l => l.trim() !== "")
    if (lines.length === 0) continue
    if (OUTFIT_PARAGRAPH.test(lines[0])) {
      outfit.push(...lines)
      continue
    }
    let otherRun = false
    for (const line of lines) {
      if (current && line.startsWith("- ")) {
        if (current.kind === "changes" && OUTFIT_CHANGE.test(line)) outfit.push(line.slice(2))
        else current.lines.push(line)
        continue
      }
      const heading = HEADINGS.find(h => h.match(line))
      if (heading) {
        current = { kind: heading.kind, title: heading.title(line), lines: [], collapsed: false }
        named.push(current)
        otherRun = false
        continue
      }
      if (line === "No context changes since last message.") {
        current = null
        named.push({ kind: "changes", title: "Changes since last message", lines: [line], collapsed: false })
        continue
      }
      // A line outside any list: the mood, tool recipes, worktrees, a closing sentence.
      current = null
      if (!otherRun && other.length > 0) other.push("")
      other.push(line)
      otherRun = true
    }
  }

  // What changed and what the agent was told about the world come first; long lists fold.
  const sections = [
    ...named.filter(section => PRIORITY.includes(section.kind))
      .sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind)),
    ...named.filter(section => !PRIORITY.includes(section.kind))
      .map(section => ({ ...section, collapsed: section.lines.length > FOLD_LIST_OVER })),
  ]
  if (outfit.length > 0) sections.push({ kind: "outfit", title: "Outfit", lines: outfit, collapsed: true })
  const prior = /<nova-prior-message[^>]*>\n?([\s\S]*?)\n?<\/nova-prior-message>/.exec(text)
  if (prior) sections.push({
    kind: "prior-message", title: "Previous assistant message", lines: prior[1].split("\n"), collapsed: true,
  })
  if (other.length > 0) sections.push({ kind: "other", title: "Other", lines: other, collapsed: false })

  return { attrs, sections, raw: text }
}

/** "4.2 KB" for a context's size in UTF-8, so a reader knows what opening it costs. */
export function formatContextSize(text: string): string {
  const bytes = new TextEncoder().encode(text).length
  return bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KB`
}

function decodeAttribute(value: string): string {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
}
