export interface MessageBlock {
  id: string
  role: "user" | "assistant"
  parts: MessagePart[]
  timestamp: string
  metadata?: Record<string, unknown>
  senderAgentId?: string
}

export interface MessagePart {
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "audio" | "image"
  content: string
  toolName?: string
  toolInput?: string
  images?: ImageAttachment[]
  isPartial?: boolean
  url?: string
  mediaType?: string
  base64?: string
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
  children?: React.ReactNode
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
  /**
   * True only for the transitional window between an interrupt being
   * requested and the turn actually unwinding (backend status "interrupting").
   * `isStreaming` stays true through this window — this flag exists so the UI
   * can say so instead of implying normal generation is still running.
   */
  interrupting: boolean
  /**
   * True after the backend reports its CLI process was force-killed and is
   * being replaced (status "killed"), until the follow-up status or error
   * lands. `isStreaming` is false here, but writing new input would race the
   * resume — callers must not treat this as safe-to-send.
   */
  resumePending: boolean
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
  /**
   * True during the transitional window after an interrupt is requested but
   * before the turn has unwound. Optional: controlled-mode consumers that
   * don't track their backend's status vocabulary this granularly can omit
   * it and lose only the more specific "interrupting" placeholder copy.
   */
  interrupting?: boolean
  /**
   * True when the backend's process was just force-killed and is being
   * replaced — not safe to send queued messages into yet. Optional for the
   * same reason as `interrupting`, but omitting it means the queue may drain
   * into a session mid-resume; see process-stream-event.ts's "killed"
   * handling for why that's unsafe.
   */
  resumePending?: boolean

  // Shared props
  sessionId?: string | null
  disabled?: boolean
  /** Read-only surfaces (e.g. Nova's heartbeat discussion): render the message
   * list without mounting the composer at all. */
  hideComposer?: boolean
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
  /**
   * Resolve a frieze event to a navigation action (e.g. open the discussion a
   * discussion-activity event points at). Return undefined when the event
   * isn't linkable — the affordance is hidden in that case.
   */
  resolveEventLink?: (event: import("./components/event-view").ParsedEvent) => (() => void) | undefined
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
  renderSideActions?: (block: MessageBlock, index: number) => React.ReactNode
}
