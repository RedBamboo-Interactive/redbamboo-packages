import { useMemo } from "react"
import type { MessageBlock } from "../types"
import { getChatStatusPresentation, isContextCompactionActive } from "../lib/chat-status"
import { getSpinnerColor } from "./chat-message"
import { MorphSpinner } from "./morph-spinner"
import { useActivityShapes } from "./activity-status-row"

/**
 * Spinner and one status text. In the chat panel's status slot it also shows
 * the activity row's shapes between the two.
 */
export function ChatStatusLine({ color, paused = false, icon, label, title }: {
  color: string
  /** Still spinner, for work that is only waiting. */
  paused?: boolean
  icon?: string
  label: string
  title?: string
}) {
  const shapes = useActivityShapes()
  return (
    <div data-slot="streaming-status-line" className="flex items-center gap-2.5 text-text-muted text-sm py-1 min-w-0" title={title}>
      <MorphSpinner color={color} paused={paused} />
      {shapes}
      {icon && <i className={`${icon} text-[10px] opacity-60`} />}
      <span className="truncate">{label}</span>
    </div>
  )
}

export function StreamingStatusLine({ isStreaming, isReconnecting = false, messages }: {
  isStreaming: boolean
  isReconnecting?: boolean
  messages: MessageBlock[]
}) {
  const spinnerColor = useMemo(() => getSpinnerColor(messages), [messages])
  const isCompacting = useMemo(() => isContextCompactionActive(messages), [messages])
  const status = getChatStatusPresentation({ isStreaming, isReconnecting, streamingColor: spinnerColor, isCompacting })

  if (!status) return null

  return <ChatStatusLine color={status.color} icon={status.icon} label={status.label} />
}
