import { ExpandableText } from "./shared"

// eslint-disable-next-line no-control-regex
const ANSI_ESCAPES = /\x1b\[[0-9;?]*[a-zA-Z]/g

const EXIT_CODE_LINE = /^Exit code:?\s+(\d+)\s*$/

/** Dim harness noise: system-reminder blocks and exit-code lines. */
function classifyLines(lines: string[]): { dims: boolean[]; exitCode: number | null } {
  const dims: boolean[] = []
  let exitCode: number | null = null
  let insideReminder = false
  for (const line of lines) {
    if (line.includes("<system-reminder>")) {
      insideReminder = !line.includes("</system-reminder>")
      dims.push(true)
      continue
    }
    if (insideReminder) {
      if (line.includes("</system-reminder>")) insideReminder = false
      dims.push(true)
      continue
    }
    const exit = line.match(EXIT_CODE_LINE)
    if (exit) {
      exitCode = Number(exit[1])
      dims.push(true)
      continue
    }
    dims.push(false)
  }
  return { dims, exitCode }
}

/**
 * Bash / PowerShell output with terminal chrome matching the shell input view:
 * dark background, monospace, ANSI codes stripped, harness noise dimmed.
 */
export function ShellOutputView({ content }: { content: string }) {
  const cleaned = content.replace(ANSI_ESCAPES, "")
  const { dims, exitCode } = classifyLines(cleaned.split("\n"))

  return (
    <div data-slot="tool-output-shell" className="space-y-2">
      <ExpandableText content={cleaned}>
        {visible => (
          <div className="rounded-md bg-black/40 px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all">
            {visible.split("\n").map((line, i) => (
              <div key={i} className={dims[i] ? "text-text-disabled" : "text-text-secondary"}>
                {line || " "}
              </div>
            ))}
          </div>
        )}
      </ExpandableText>
      {exitCode != null && exitCode !== 0 && (
        <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent-red-a10 text-accent-red">
          exit {exitCode}
        </span>
      )}
    </div>
  )
}
