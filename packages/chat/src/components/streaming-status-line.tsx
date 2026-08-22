import { useMemo } from "react"
import type { MessageBlock } from "../types"
import { getChatStatusPresentation } from "../lib/chat-status"
import { getSpinnerColor } from "./chat-message"
import { MorphSpinner } from "./morph-spinner"

export function ChatStatusLine({ color, icon, label }: {
  color: string
  icon?: string
  label: string
}) {
  return (
    <div data-slot="streaming-status-line" className="flex items-center gap-2.5 text-text-muted text-sm py-1">
      <MorphSpinner color={color} />
      {icon && <i className={`${icon} text-[10px] opacity-60`} />}
      <span>{label}</span>
    </div>
  )
}

export function StreamingStatusLine({ isStreaming, isReconnecting = false, messages }: {
  isStreaming: boolean
  isReconnecting?: boolean
  messages: MessageBlock[]
}) {
  const spinnerColor = useMemo(() => getSpinnerColor(messages), [messages])
  const status = getChatStatusPresentation({ isStreaming, isReconnecting, streamingColor: spinnerColor })

  if (!status) return null

  return <ChatStatusLine color={status.color} icon={status.icon} label={status.label} />
}
