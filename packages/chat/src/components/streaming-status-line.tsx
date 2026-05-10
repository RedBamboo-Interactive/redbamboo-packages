import { useMemo } from "react"
import type { MessageBlock } from "../types"
import { getSpinnerColor } from "./chat-message"
import { MorphSpinner } from "./morph-spinner"

export function StreamingStatusLine({ isStreaming, messages }: {
  isStreaming: boolean
  messages: MessageBlock[]
}) {
  const spinnerColor = useMemo(() => getSpinnerColor(messages), [messages])

  if (!isStreaming) return null

  return (
    <div data-slot="streaming-status-line" className="flex items-center gap-2.5 text-text-muted text-sm py-1">
      <MorphSpinner color={spinnerColor} />
      <span>Responding...</span>
    </div>
  )
}
