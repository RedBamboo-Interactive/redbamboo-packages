import { ExpandableText, OutputFileLink, parseToolInput, type OutputResolvers } from "./shared"

// path:line:content — tolerates a Windows drive-letter prefix in the path.
const MATCH_LINE = /^((?:[A-Za-z]:)?[^:\n]+):(\d+):(.*)$/

interface GrepMatch {
  line: number
  text: string
}

/** Build the highlight regex: user pattern → escaped literal → none. */
function buildHighlighter(pattern: string | undefined, caseInsensitive: boolean): RegExp | null {
  if (!pattern) return null
  const flags = caseInsensitive ? "gi" : "g"
  try {
    return new RegExp(pattern, flags)
  } catch {
    try {
      return new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), flags)
    } catch {
      return null
    }
  }
}

function HighlightedMatch({ text, highlighter }: { text: string; highlighter: RegExp | null }) {
  if (!highlighter) return <>{text}</>
  const nodes: React.ReactNode[] = []
  let last = 0
  highlighter.lastIndex = 0
  let m: RegExpExecArray | null
  let guard = 0
  while ((m = highlighter.exec(text)) !== null && guard++ < 100) {
    if (m[0].length === 0) { highlighter.lastIndex++; continue }
    if (m.index > last) nodes.push(<span key={`t${last}`}>{text.slice(last, m.index)}</span>)
    nodes.push(
      <span key={`m${m.index}`} className="bg-accent-gold-a20 text-amber-300-a90 rounded-[2px]">
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(<span key={`t${last}`}>{text.slice(last)}</span>)
  return <>{nodes}</>
}

/**
 * Grep tool output: content-mode matches grouped by file with line numbers and
 * pattern highlighting; files_with_matches mode as a linked file list. Falls
 * back to a plain block when neither shape is recognized.
 */
export function GrepOutputView({ content, toolInput, resolvers }: {
  content: string
  toolInput?: string
  resolvers: OutputResolvers
}) {
  const input = parseToolInput(toolInput)
  const pattern = typeof input?.pattern === "string" ? input.pattern : undefined
  const highlighter = buildHighlighter(pattern, input?.["-i"] === true)

  const lines = content.split("\n")
  const byFile = new Map<string, GrepMatch[]>()
  const bareFiles: string[] = []
  let unparsed = 0

  for (const line of lines) {
    if (!line.trim()) continue
    const m = line.match(MATCH_LINE)
    if (m) {
      const matches = byFile.get(m[1]) ?? []
      matches.push({ line: Number(m[2]), text: m[3] })
      byFile.set(m[1], matches)
    } else if (/^(?:[A-Za-z]:)?[^:\s][^:]*$/.test(line.trim()) && /[\\/.]/.test(line)) {
      bareFiles.push(line.trim())
    } else {
      unparsed++
    }
  }

  // Recognized nothing structured — plain fallback.
  if (byFile.size === 0 && bareFiles.length === 0) {
    return (
      <ExpandableText content={content}>
        {visible => <pre className="text-xs font-mono whitespace-pre-wrap break-all">{visible}</pre>}
      </ExpandableText>
    )
  }

  return (
    <div data-slot="tool-output-grep" className="space-y-3">
      {[...byFile.entries()].map(([path, matches]) => (
        <div key={path} className="space-y-0.5">
          <OutputFileLink path={path} resolvers={resolvers} />
          <div className="rounded-md bg-overlay-3 px-2.5 py-1.5 font-mono text-xs space-y-0.5">
            {matches.map((match, i) => (
              <div key={i} className="flex gap-2">
                <LineNumber path={path} line={match.line} resolvers={resolvers} />
                <span className="whitespace-pre-wrap break-all min-w-0 text-text-secondary">
                  <HighlightedMatch text={match.text} highlighter={highlighter} />
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      {bareFiles.length > 0 && (
        <div className="space-y-1">
          {bareFiles.map((path, i) => (
            <div key={i}>
              <OutputFileLink path={path} resolvers={resolvers} />
            </div>
          ))}
        </div>
      )}
      {unparsed > 0 && (
        <p className="text-[10px] text-text-disabled">{unparsed} additional line{unparsed === 1 ? "" : "s"} not shown</p>
      )}
    </div>
  )
}

function LineNumber({ path, line, resolvers }: { path: string; line: number; resolvers: OutputResolvers }) {
  const open = resolvers.resolveFileLink?.(path, { line })
  if (!open) return <span className="text-text-disabled select-none shrink-0 w-8 text-right">{line}</span>
  return (
    <button
      onClick={() => { resolvers.onNavigate?.(); open() }}
      className="text-text-disabled hover:text-contrast transition-colors shrink-0 w-8 text-right cursor-pointer"
      title={`Open at line ${line}`}
    >
      {line}
    </button>
  )
}
