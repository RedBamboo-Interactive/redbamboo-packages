export interface ChatStatusPresentation {
  color: string
  icon?: string
  label: string
}

export function getChatStatusPresentation({
  isStreaming,
  isReconnecting,
  streamingColor,
}: {
  isStreaming: boolean
  isReconnecting: boolean
  streamingColor: string
}): ChatStatusPresentation | null {
  if (isReconnecting) {
    return {
      color: "#ef4444",
      icon: "ph-bold ph-arrows-clockwise",
      label: "Reconnecting...",
    }
  }

  if (!isStreaming) return null

  return {
    color: streamingColor,
    label: "Responding...",
  }
}
