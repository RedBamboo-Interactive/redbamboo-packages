import { JsonHighlight } from "@redbamboo/utility"
import { ExpandableText, type OutputResolvers } from "./shared"
import { ReadOutputView } from "./read"
import { GrepOutputView } from "./grep"
import { FileListOutputView } from "./file-list"
import { ShellOutputView } from "./shell"
import { MarkdownOutputView } from "./markdown"
import { WebSearchOutputView } from "./web"

interface Props {
  content: string
  isError?: boolean
  /** Name of the tool that produced this output — enables per-tool rendering. */
  toolName?: string
  /** The paired tool_use input JSON — file path, pattern, etc. */
  toolInput?: string
  resolveFileLink?: (filePath: string, opts?: { line?: number }) => (() => void) | undefined
  resolveImageSrc?: (src: string) => string | undefined
  /** Called before a resolved file link fires, so the host modal can close. */
  onNavigate?: () => void
}

export function ToolOutputView({ content, isError, toolName, toolInput, resolveFileLink, resolveImageSrc, onNavigate }: Props) {
  if (!content) {
    return <p className="text-xs text-text-disabled italic">No output</p>
  }

  if (isError) {
    return (
      <div className="rounded-md bg-red-500-a6 px-3 py-2 -mx-3 -mb-1">
        <ExpandableText content={content}>
          {visible => <pre className="text-xs font-mono whitespace-pre-wrap break-all text-red-300-a80">{visible}</pre>}
        </ExpandableText>
      </div>
    )
  }

  const resolvers: OutputResolvers = { resolveFileLink, resolveImageSrc, onNavigate }

  switch (toolName?.toLowerCase()) {
    case "read":
      return <ReadOutputView content={content} toolInput={toolInput} resolvers={resolvers} />
    case "grep":
      return <GrepOutputView content={content} toolInput={toolInput} resolvers={resolvers} />
    case "glob":
    case "list":
      return <FileListOutputView content={content} resolvers={resolvers} />
    case "bash":
    case "powershell":
      return <ShellOutputView content={content} />
    case "agent":
    case "task":
    case "webfetch":
      return <MarkdownOutputView content={content} resolvers={resolvers} />
    case "websearch":
      return <WebSearchOutputView content={content} />
  }

  const isJson = content.trimStart().startsWith("{") || content.trimStart().startsWith("[")
  let parsedJson = false
  if (isJson) {
    try {
      JSON.parse(content)
      parsedJson = true
    } catch { /* not valid json */ }
  }

  return (
    <ExpandableText content={content}>
      {visible => parsedJson ? (
        <JsonHighlight json={visible} />
      ) : (
        <pre className="text-xs font-mono whitespace-pre-wrap break-all">{visible}</pre>
      )}
    </ExpandableText>
  )
}
