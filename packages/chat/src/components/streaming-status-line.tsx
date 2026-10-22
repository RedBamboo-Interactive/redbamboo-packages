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
export function ChatStatusLine({ color, icon, label, detail, title }: {
  color: string
  icon?: string
  label: string
  /** Secondary text after the label, e.g. the leading agent's latest progress. */
  detail?: string
  title?: string
}) {
  const shapes = useActivityShapes()
  return (
    <div data-slot="streaming-status-line" className="flex items-center gap-2.5 text-text-muted text-sm py-1 min-w-0" title={title}>
      <MorphSpinner color={color} />
      {shapes}
      {icon && <i className={`${icon} text-[10px] opacity-60`} />}
      <span className="shrink-0">{label}</span>
      {detail && <span aria-hidden className="text-text-disabled">·</span>}
      {detail && <span className="truncate text-text-disabled">{detail}</span>}
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
