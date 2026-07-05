import { useState } from "react"
import {
  ExpandableText, HighlightedCode, OutputFileLink,
  langFromPath, isImagePath, parseToolInput,
  type OutputResolvers,
} from "./shared"

const LINE_NUMBER_PREFIX = /^\s*(\d+)\t/

/**
 * Read tool output: syntax-highlighted file content (language from the paired
 * input's file path), with the harness's `cat -n` line-number prefixes
 * stripped. Image files render inline when the host can resolve them to a URL.
 */
export function ReadOutputView({ content, toolInput, resolvers }: {
  content: string
  toolInput?: string
  resolvers: OutputResolvers
}) {
  const input = parseToolInput(toolInput)
  const path = typeof input?.file_path === "string" ? input.file_path : undefined
  const [imageFailed, setImageFailed] = useState(false)

  if (path && isImagePath(path) && !imageFailed) {
    const src = resolvers.resolveImageSrc?.(path)
    if (src) {
      return (
        <div data-slot="tool-output-read" className="space-y-2">
          <img
            src={src}
            alt={path}
            loading="lazy"
            className="max-h-64 rounded-md border border-border-subtle object-contain"
            onError={() => setImageFailed(true)}
          />
          <OutputFileLink path={path} resolvers={resolvers} />
        </div>
      )
    }
  }

  // Detect the `cat -n`-style "  123\tcode" format on the first content line.
  const firstLine = content.split("\n", 1)[0] ?? ""
  const numbered = LINE_NUMBER_PREFIX.test(firstLine)
  let code = content
  let startLine: number | undefined
  if (numbered) {
    startLine = Number(firstLine.match(LINE_NUMBER_PREFIX)?.[1])
    code = content
      .split("\n")
      .map(line => line.replace(LINE_NUMBER_PREFIX, ""))
      .join("\n")
  }

  return (
    <div data-slot="tool-output-read" className="space-y-1.5">
      {startLine != null && startLine > 1 && (
        <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-muted">
          from line {startLine}
        </span>
      )}
      <ExpandableText content={code}>
        {visible => <HighlightedCode code={visible} lang={langFromPath(path)} />}
      </ExpandableText>
    </div>
  )
}
