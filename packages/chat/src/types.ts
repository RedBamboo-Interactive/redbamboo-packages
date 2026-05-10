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

// --- Speech / voice types ---

export interface SpeechBackend {
  transcribe(audio: Blob, signal?: AbortSignal): Promise<string>
  speak(text: string, options?: SpeakOptions, signal?: AbortSignal): Promise<ArrayBuffer>
  reformulate?(rawText: string, context: ConversationEntry[], signal?: AbortSignal): Promise<string>
  summarize?(context: ConversationEntry[], sessionName: string, signal?: AbortSignal): Promise<string>
}

export interface SpeakOptions {
  voice?: string
  instructions?: string
}

export interface ConversationEntry {
  role: "user" | "assistant"
  content: string
}

export type VoiceInputState = "idle" | "recording" | "processing" | "error"

export interface VoiceInputHandle {
  state: VoiceInputState
  error: string | null
  transcript: string | null
  startRecording: () => Promise<void>
  stopRecording: () => Promise<void>
  cancelRecording: () => void
}

export type ExchangeState =
  | "idle"
  | "summarizing"
  | "speaking"
  | "waiting"
  | "listening"
  | "processing"
  | "sending"
  | "error"

export interface HandsFreeContextValue {
  enabled: boolean
  exchangeState: ExchangeState
  currentSessionId: string | null
  currentSessionTitle: string | null
  queueLength: number
  lastSummary: string | null
  lastTranscript: string | null
  error: string | null
  sessionCount: number
  enable: () => Promise<void>
  disable: () => void
  skip: () => void
  startListening: () => Promise<void>
  stopListening: () => Promise<void>
  cancelListening: () => void
}

// --- ChatPanel types ---

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
