import { MarkdownRenderer } from "../streaming-text"
import { parseStructuredJson } from "../../lib/structured-data"
import { StructuredDataView } from "../structured-data-view"
import { ExpandableText, type OutputResolvers } from "./shared"

/**
 * Agent / Task / WebFetch results: markdown rendering instead of raw text.
 * Agents sometimes return structured output — pure JSON renders as the
 * structured key/value view.
 */
export function MarkdownOutputView({ content, resolvers }: {
  content: string
  resolvers: OutputResolvers
}) {
  const trimmed = content.trimStart()
  const structured = trimmed.startsWith("{") || trimmed.startsWith("[")
    ? parseStructuredJson(content)
    : undefined
  if (structured !== undefined) {
    return <StructuredDataView value={structured} rawJson={content} resolveImageSrc={resolvers.resolveImageSrc} />
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
