import { useState } from "react"
import Markdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"

export interface OutputResolvers {
  resolveFileLink?: (filePath: string, opts?: { line?: number }) => (() => void) | undefined
  resolveImageSrc?: (src: string) => string | undefined
  /** Called before a resolved file link fires, so the host modal can close. */
  onNavigate?: () => void
}

export const COLLAPSED_LEN = 5000
const EXPAND_STEP = 20000
export const HARD_CAP = 100000

/**
 * Expandable truncation shared by every output renderer: 5k chars collapsed,
 * "Show more" grows in 20k steps up to a 100k hard cap.
 */
export function ExpandableText({ content, children }: {
  content: string
  children: (visible: string) => React.ReactNode
}) {
  const [limit, setLimit] = useState(COLLAPSED_LEN)
  const capped = Math.min(content.length, HARD_CAP)
  const visible = content.slice(0, Math.min(limit, capped))
  const hasMore = visible.length < capped

  return (
    <div data-slot="tool-output-expandable">
      {children(visible)}
      {(hasMore || content.length > HARD_CAP) && (
        <div className="flex items-baseline gap-3 mt-1">
          {hasMore && (
            <button
              onClick={() => setLimit(l => l + EXPAND_STEP)}
              className="text-[10px] text-text-muted hover:text-contrast transition-colors cursor-pointer"
            >
              Show more
            </button>
          )}
          <p className="text-[10px] text-text-disabled">
            Truncated ({content.length.toLocaleString()} chars total)
          </p>
        </div>
      )}
    </div>
  )
}

const EXT_LANG: Record<string, string> = {
  ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", mjs: "javascript", cjs: "javascript",
  py: "python", cs: "csharp", rs: "rust", go: "go", java: "java", rb: "ruby", php: "php",
  json: "json", css: "css", scss: "scss", html: "html", md: "markdown",
  ps1: "powershell", psm1: "powershell", sh: "bash", bash: "bash", zsh: "bash",
  sql: "sql", yml: "yaml", yaml: "yaml", toml: "toml", xml: "xml", svg: "xml",
}

export function langFromPath(path: string | undefined): string | undefined {
  if (!path) return undefined
  const ext = path.split(".").pop()?.toLowerCase()
  return ext ? EXT_LANG[ext] : undefined
}

const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i

export function isImagePath(path: string | undefined): boolean {
  return !!path && IMAGE_EXTENSIONS.test(path)
}

/**
 * Syntax-highlighted code via the existing react-markdown + rehype-highlight
 * pipeline (no new dependencies). Falls back to a plain block when the code
 * itself contains a fence that would break the wrapping.
 */
export function HighlightedCode({ code, lang }: { code: string; lang?: string }) {
  if (!lang || code.includes("```")) {
    return <pre className="text-xs font-mono whitespace-pre-wrap break-all">{code}</pre>
  }
  return (
    <div className="markdown-body text-xs [&_pre]:my-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-all">
      <Markdown rehypePlugins={[rehypeHighlight]}>{`\`\`\`${lang}\n${code}\n\`\`\``}</Markdown>
    </div>
  )
}

/** File path rendered as a jump-to-editor link when the host can resolve it. */
export function OutputFileLink({ path, line, resolvers, className }: {
  path: string
  line?: number
  resolvers: OutputResolvers
  className?: string
}) {
  const open = resolvers.resolveFileLink?.(path, line != null ? { line } : undefined)
  const base = className ?? "font-mono text-xs text-amber-300-a90"
  if (!open) return <span className={`${base} break-all`}>{path}</span>
  return (
    <button
      onClick={() => { resolvers.onNavigate?.(); open() }}
      className={`group inline-flex items-center gap-1.5 ${base} hover:underline underline-offset-2 text-left break-all cursor-pointer`}
      title="Open in editor"
    >
      {path}
      <i className="ph-fill ph-arrow-square-out text-[9px] opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
    </button>
  )
}

export function parseToolInput(toolInput: string | undefined): Record<string, unknown> | null {
  if (!toolInput) return null
  try {
    const parsed = JSON.parse(toolInput)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}
