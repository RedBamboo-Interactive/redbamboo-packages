import { ExpandableText } from "./shared"

const URL_PATTERN = /https?:\/\/[^\s)\]}"']+/

function truncateMiddle(url: string, max = 72): string {
  if (url.length <= max) return url
  const half = Math.floor((max - 1) / 2)
  return `${url.slice(0, half)}…${url.slice(-half)}`
}

/**
 * WebSearch output: the format is loosely structured text with URLs — linkify
 * URL lines, bold their preceding title lines, leave the rest as prose. Falls
 * back to a plain block when no URLs are present at all.
 */
export function WebSearchOutputView({ content }: { content: string }) {
  if (!URL_PATTERN.test(content)) {
    return (
      <ExpandableText content={content}>
        {visible => <pre className="text-xs font-mono whitespace-pre-wrap break-all">{visible}</pre>}
      </ExpandableText>
    )
  }

  return (
    <ExpandableText content={content}>
      {visible => {
        const lines = visible.split("\n")
        return (
          <div data-slot="tool-output-websearch" className="space-y-0.5 text-xs">
            {lines.map((line, i) => {
              const url = line.match(URL_PATTERN)?.[0]
              if (url) {
                return (
                  <p key={i} className="break-all">
                    <a
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent-teal-a80 hover:underline underline-offset-2"
                    >
                      {truncateMiddle(url)}
                    </a>
                  </p>
                )
              }
              const nextHasUrl = i + 1 < lines.length && URL_PATTERN.test(lines[i + 1])
              if (!line.trim()) return <div key={i} className="h-1.5" />
              return (
                <p key={i} className={nextHasUrl ? "font-medium text-text-primary font-serif" : "text-text-secondary font-serif"}>
                  {line}
                </p>
              )
            })}
          </div>
        )
      }}
    </ExpandableText>
  )
}
