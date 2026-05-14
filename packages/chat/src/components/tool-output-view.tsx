import { JsonHighlight } from "@redbamboo/utility"

interface Props {
  content: string
  isError?: boolean
}

const MAX_LEN = 5000

export function ToolOutputView({ content, isError }: Props) {
  if (!content) {
    return <p className="text-xs text-text-disabled italic">No output</p>
  }

  const truncated = content.length > MAX_LEN
  const display = truncated ? content.slice(0, MAX_LEN) : content

  const isJson = display.trimStart().startsWith("{") || display.trimStart().startsWith("[")
  let parsedJson = false
  if (isJson) {
    try {
      JSON.parse(display)
      parsedJson = true
    } catch { /* not valid json */ }
  }

  return (
    <div className={isError ? "rounded-md bg-red-500-a6 px-3 py-2 -mx-3 -mb-1" : undefined}>
      {parsedJson ? (
        <JsonHighlight json={display} />
      ) : (
        <pre className={`text-xs font-mono whitespace-pre-wrap break-all ${isError ? "text-red-300-a80" : ""}`}>
          {display}
        </pre>
      )}
      {truncated && (
        <p className="text-[10px] text-text-disabled mt-1">Truncated ({content.length.toLocaleString()} chars total)</p>
      )}
    </div>
  )
}
