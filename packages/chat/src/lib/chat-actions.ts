// Leaf context-menu item descriptors for chat objects: messages, fenced code,
// activity squares and artifacts. Each array feeds both the object's visible
// menu and its right-click / long-press menu, so the two cannot drift.

import type { ContextMenuEntry } from "@redbamboo/ui"
import type { MessageBlock } from "../types"
import { stripHiddenMessageEnvelopes } from "./message-content.ts"

/**
 * The Markdown a message renders: a person's envelope-stripped text (the same
 * string the bubble renders), or an assistant's text parts in order.
 */
export function messageMarkdown(block: MessageBlock): string {
  if (block.role === "user") return stripHiddenMessageEnvelopes(block.parts[0]?.content || "")
  return block.parts
    .filter(part => part.type === "text" && part.content.trim())
    .map(part => part.content)
    .join("\n\n")
}

export interface MessageActionOptions {
  /** From {@link messageMarkdown}; no copy items when it is blank. */
  markdown: string
  copyText: () => void
  copyMarkdown: () => void
  /** Host items (Nova's React), after the copy items. */
  extra?: readonly ContextMenuEntry[]
  /** Opens the message's info dialog; omitted while the message is still streaming. */
  openInfo?: () => void
}

export function messageActionEntries(options: MessageActionOptions): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = []
  if (options.markdown.trim()) {
    entries.push(
      { id: "message-copy-text", label: "Copy text", icon: "ph-bold ph-copy", run: () => options.copyText() },
      { id: "message-copy-markdown", label: "Copy as Markdown", icon: "ph-bold ph-markdown-logo", run: () => options.copyMarkdown() },
    )
  }
  if (options.extra?.length) entries.push({ id: "message-extra-separator", separator: true }, ...options.extra)
  if (options.openInfo) {
    const openInfo = options.openInfo
    entries.push(
      { id: "message-info-separator", separator: true },
      { id: "message-info", label: "Info", icon: "ph-bold ph-info", run: () => openInfo() },
    )
  }
  return entries
}

export function codeBlockActionEntries(copy: () => void): ContextMenuEntry[] {
  return [{ id: "code-copy", label: "Copy code", icon: "ph-bold ph-copy", run: () => copy() }]
}

/** Minimal hast shape: react-markdown passes these as `node`. */
export interface HastLike {
  type: string
  value?: string
  tagName?: string
  children?: readonly HastLike[]
}

function hastText(node: HastLike): string {
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map(hastText).join("")
}

/**
 * The authored source of a fenced block from its `pre` node. Highlighting only
 * wraps the text in spans, so the text nodes are still the source; Markdown
 * adds one trailing newline to every block, which is not part of it.
 */
export function codeBlockSource(pre: HastLike | undefined): string {
  if (!pre) return ""
  const code = pre.children?.find(child => child.type === "element" && child.tagName === "code") ?? pre
  return hastText(code).replace(/\n$/, "")
}

export interface PartActionOptions {
  openDetails: () => void
  /** The tool's file, through the host's file resolver. */
  openFile?: () => void
  /** The Compute job a launching square ran as (`/apps/compute/jobs?select=…`). */
  jobHref?: string
}

export function partActionEntries(options: PartActionOptions): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = [
    { id: "part-open-details", label: "Open details", icon: "ph-bold ph-arrows-out-simple", run: () => options.openDetails() },
  ]
  if (options.openFile) {
    const openFile = options.openFile
    entries.push({ id: "part-open-file", label: "Open in editor", icon: "ph-bold ph-code", run: () => openFile() })
  }
  if (options.jobHref) {
    const href = options.jobHref
    entries.push({ id: "part-open-job", label: "Open job in Compute", icon: "ph-bold ph-arrow-square-out", run: (ctx) => ctx.navigate(href) })
  }
  return entries
}

export interface ArtifactActionOptions {
  /** Absent when the artifact cannot be opened. */
  open?: () => void
  /** "Open", "Play" or "Open in editor", matching the row's own primary action. */
  openLabel?: string
  /** Absent when the host has no chat to jump to, or the artifact has no message. */
  goToMessage?: () => void
}

export function artifactActionEntries(options: ArtifactActionOptions): ContextMenuEntry[] {
  const entries: ContextMenuEntry[] = []
  if (options.open) {
    const open = options.open
    entries.push({ id: "artifact-open", label: options.openLabel ?? "Open", icon: "ph-bold ph-arrow-square-out", run: () => open() })
  }
  if (options.goToMessage) {
    const goToMessage = options.goToMessage
    entries.push({ id: "artifact-go-to-message", label: "Go to message", icon: "ph-bold ph-arrow-bend-up-left", run: () => goToMessage() })
  }
  return entries
}
