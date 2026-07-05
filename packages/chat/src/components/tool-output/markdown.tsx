import { JsonHighlight } from "@redbamboo/utility"
import { MarkdownRenderer } from "../streaming-text"
import { ExpandableText, type OutputResolvers } from "./shared"

/**
 * Agent / Task / WebFetch results: markdown rendering instead of raw text.
 * Agents sometimes return structured output — pure JSON falls back to the
 * JSON highlighter.
 */
export function MarkdownOutputView({ content, resolvers }: {
  content: string
  resolvers: OutputResolvers
}) {
  const trimmed = content.trimStart()
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      JSON.parse(content)
      return (
        <ExpandableText content={content}>
          {visible => <JsonHighlight json={visible} />}
        </ExpandableText>
      )
    } catch { /* not JSON — markdown path */ }
  }

  return (
    <ExpandableText content={content}>
      {visible => (
        <div data-slot="tool-output-markdown" className="text-sm leading-relaxed font-serif markdown-body">
          <MarkdownRenderer content={visible} resolveImageSrc={resolvers.resolveImageSrc} />
        </div>
      )}
    </ExpandableText>
  )
}
