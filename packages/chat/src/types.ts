export interface MessageBlock {
  id: string
  role: "user" | "assistant"
  parts: MessagePart[]
  timestamp: string
  metadata?: Record<string, unknown>
  senderAgentId?: string
}

export interface MessagePart {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "audio"
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

export interface SendOptions {
  inputMethod?: "typed" | "voice"
}

export interface ChatEvent {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "status"
  content?: string | null
  toolName?: string | null
  toolInput?: string | null
  toolResult?: string | null
  messageId?: string | null
  /**
   * Provider-neutral message identity minted server-side. All events of one
   * assistant turn share it, and the persisted records carry the same value —
   * so a block built from the stream and the same block rebuilt from history
   * get the same id. Absent on events from older backends.
   */
  messageUid?: string | null
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
  interimTranscript: string | null
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

// --- Session stats / context indicator ---

export interface SessionStats {
  name?: string | null
  jobHash?: string | null
  sessionId?: string | null
  discussionId?: string | null
  model?: string | null
  status?: string
  startedAt?: string
  costUsd?: number | null
  messageCount?: number
  outputTokens?: number | null
  cachedInputTokens?: number | null
  contextTokens?: number | null
  contextWindow?: number | null
  effort?: string | null
  qualityTier?: string | null
}

export interface SessionConfigOption {
  value: string
  label: string
  color?: string
  icon?: string
}

export interface ContextIndicatorProps {
  stats: SessionStats | null
  messages: MessageBlock[]
  modelOptions?: SessionConfigOption[]
  effortOptions?: SessionConfigOption[]
  qualityTierOptions?: SessionConfigOption[]
  onConfigChange?: (config: { model?: string; effort?: string; qualityTier?: string }) => Promise<void>
}

// --- Stream event processing ---

export interface QuestionOption {
  label: string
  description?: string
}

export interface StructuredQuestion {
  question: string
  header?: string
  multiSelect: boolean
  options: QuestionOption[]
}

export interface PendingQuestion {
  question: string
  questions?: StructuredQuestion[]
}

export interface ProcessEventResult {
  messages: MessageBlock[]
  isStreaming: boolean
  pendingQuestion: PendingQuestion | null
}

// --- ChatPanel types ---

export interface ChatPanelProps {
  // Uncontrolled mode: ChatPanel manages state via useChatStream
  backend?: ChatBackend

  // Controlled mode: consumer provides state + callbacks
  messages?: MessageBlock[]
  isStreaming?: boolean
  onSend?: (content: string, images?: ImageAttachment[], options?: SendOptions) => void
  onInterrupt?: () => void

  // Shared props
  sessionId?: string | null
  disabled?: boolean
  pendingQuestion?: PendingQuestion | null
  onAnswerQuestion?: (answer: string) => void
  onResume?: () => void | Promise<void>
  placeholder?: string
  className?: string
  header?: React.ReactNode
  footer?: React.ReactNode
  resolveImageSrc?: (src: string) => string | undefined
  /**
   * Resolve a file path from a tool call (Read/Write/Edit…) to an action that
   * opens it (e.g. in an editor tab). Return undefined when the file can't be
   * opened — the jump button is hidden in that case.
   */
  resolveFileLink?: (filePath: string, opts?: { line?: number }) => (() => void) | undefined
  permissionMode?: string
  onTogglePlanMode?: () => void
  onExecutePlan?: () => void
  enableImageAttachments?: boolean
  enableFileAttachments?: boolean
  draftStorageKey?: string

  // Voice integration
  speechBackend?: SpeechBackend
  handsFreeEnabled?: boolean
  pushToTalkKey?: string

  // Avatar
  assistantAvatar?: string
  resolveAgentInfo?: (agentId: string) => { name: string; avatarUrl: string } | undefined

  // Render props
  renderStatusLine?: (state: {
    isStreaming: boolean
    messages: MessageBlock[]
    pendingQuestion: PendingQuestion | null
  }) => React.ReactNode
  renderComposerInlineAction?: (state: {
    value: string
    isStreaming: boolean
    disabled: boolean
    hasImages: boolean
  }) => React.ReactNode
  renderMessageExtra?: (block: MessageBlock, index: number) => React.ReactNode
}
