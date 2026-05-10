export interface MessageBlock {
  id: string
  role: "user" | "assistant"
  parts: MessagePart[]
  timestamp: string
}

export interface MessagePart {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error"
  content: string
  toolName?: string
  toolInput?: string
  images?: ImageAttachment[]
  isPartial?: boolean
}

export interface ImageAttachment {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  base64: string
}

export interface ChatEvent {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "status"
  content?: string | null
  toolName?: string | null
  toolInput?: string | null
  toolResult?: string | null
  messageId?: string | null
}

export interface ChatBackend {
  sendMessage(text: string, images?: ImageAttachment[]): Promise<{ sessionId: string }>
  subscribe(sessionId: string, onEvent: (event: ChatEvent) => void): () => void
  getHistory?(limit?: number): Promise<MessageBlock[]>
  interrupt?(sessionId: string): Promise<void>
  reset?(): Promise<void>
}

export interface ChatPanelProps {
  backend: ChatBackend
  placeholder?: string
  className?: string
  header?: React.ReactNode
  resolveImageSrc?: (src: string) => string | undefined
  permissionMode?: string
  onTogglePlanMode?: () => void
  onExecutePlan?: () => void
  renderStatusLine?: (state: {
    isStreaming: boolean
    messages: MessageBlock[]
  }) => React.ReactNode
  renderComposerInlineAction?: (state: {
    value: string
    isStreaming: boolean
    disabled: boolean
    hasImages: boolean
  }) => React.ReactNode
}
