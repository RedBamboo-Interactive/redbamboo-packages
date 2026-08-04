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
  attachments?: UploadedAttachment[]
  isPartial?: boolean
  url?: string
  mediaType?: string
  base64?: string
  payloadRef?: TranscriptPayloadRef
}

export interface TranscriptPayloadRef {
  recordId: number
  kind: string
  length: number
  contentType: string
  encoding: string
  sha256: string
  available: boolean
}

export interface TranscriptPayloadRange {
  start: number
  /** Exclusive byte offset. */
  end: number
}

export interface TranscriptPayloadChunk {
  bytes: Uint8Array
  start: number
  /** Exclusive byte offset. */
  end: number
  total: number
}

export type TranscriptPayloadLoader = (
  ref: TranscriptPayloadRef,
  range: TranscriptPayloadRange,
  signal: AbortSignal,
) => Promise<TranscriptPayloadChunk>

export interface ImageAttachment {
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp"
  base64: string
}

export type ChatInputPart =
  | { type: "text"; text: string }
  | { type: "attachment"; attachmentId: string }

export interface UploadedAttachment {
  id: string
  kind: "image" | "file"
  name: string
  mediaType: string
  size: number
  sha256?: string
  downloadUrl: string
  expiresAt?: string | null
}

export interface DraftAttachment extends UploadedAttachment {
  clientId: string
  state: "uploading" | "ready" | "error"
  error?: string
  previewUrl?: string
  /** In-memory only, retained so a failed upload can be retried. */
  file?: File
}

export interface AttachmentTransport {
  upload(file: File, signal?: AbortSignal): Promise<UploadedAttachment>
  delete(attachmentId: string): Promise<void>
  getDownloadUrl?(attachment: UploadedAttachment): string
}

export interface SendOptions {
  inputMethod?: "typed" | "voice"
}

export interface ChatEvent {
  /**
   * `question` / `question_resolved` are control events, not conversation:
   * they open and close a pending question rather than adding a message part.
   * See process-stream-event.ts for why the pending question can't be inferred
   * from the parts alone.
   */
  type: "text" | "thinking" | "tool_use" | "tool_result" | "error" | "status" | "question" | "question_resolved"
  content?: string | null
  toolName?: string | null
  toolInput?: string | null
  toolResult?: string | null
  payloadRef?: TranscriptPayloadRef | null
  messageId?: string | null
  /**
   * Provider-neutral message identity minted server-side. All events of one
   * assistant turn share it, and the persisted records carry the same value —
   * so a block built from the stream and the same block rebuilt from history
   * get the same id. Absent on events from older backends.
   */
  messageUid?: string | null
  /**
   * Correlation id for the tool call the backend is parked on, carried by
   * `question` and echoed by `question_resolved`. Clients send it back when
   * submitting an answer. It is live-only — a reload cannot replay it, which
   * is why those events are deliberately not persisted.
   */
  requestId?: string | null
}

export interface ChatBackend {
  sendMessage(text: string, images?: ImageAttachment[]): Promise<{ sessionId: string }>
  sendInput?(input: ChatInputPart[], attachments: UploadedAttachment[]): Promise<{ sessionId: string }>
  subscribe(sessionId: string, onEvent: (event: ChatEvent) => void): () => void
  getHistory?(limit?: number): Promise<MessageBlock[]>
  interrupt?(sessionId: string): Promise<void>
  reset?(): Promise<void>
  /**
   * Unblock a tool call the session is parked on (Claude Code's
   * AskUserQuestion). Not a conversation turn — backends that route answers
   * back through `sendMessage` simply omit it.
   */
  answerQuestion?(sessionId: string, payload: QuestionAnswerPayload): Promise<void>
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
  costEstimated?: boolean
  messageCount?: number
  outputTokens?: number | null
  cachedInputTokens?: number | null
  contextTokens?: number | null
  contextWindow?: number | null
  effort?: string | null
  qualityTier?: string | null
  provider?: string | null
  providerEntity?: string | null
}

export interface SessionConfigOption {
  value: string
  label: string
  color?: string
  icon?: string
  iconSvgPath?: string
  aliases?: string[]
}

export interface SessionAgentInfo {
  id: string
  name: string
  avatarUrl?: string | null
}

export interface ContextIndicatorProps {
  stats: SessionStats | null
  messages: MessageBlock[]
  agent?: SessionAgentInfo | null
  modelOptions?: SessionConfigOption[]
  effortOptions?: SessionConfigOption[]
  qualityTierOptions?: SessionConfigOption[]
  providerOptions?: SessionConfigOption[]
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
  /**
   * Correlation id from the backend's `question` event. Present only when the
   * question is *authoritative* — i.e. the backend told us it is parked and is
   * waiting for this exact id back. Null when the question was inferred from
   * the message parts (the fallback path for backends that don't emit
   * `question` events); such a question can only be answered as a plain turn.
   */
  requestId?: string | null
}

/**
 * How a question stopped being pending. The first five come verbatim from the
 * backend's `question_resolved` event; `unresolved` is minted client-side when
 * the pending question was torn down without one — e.g. the tool errored out.
 * Only `answered`/`declined` mean the user actually replied.
 */
export type QuestionOutcome =
  | "answered"
  | "declined"
  | "timeout"
  | "cancelled"
  | "session_ended"
  | "unresolved"

/** What a client sends to unblock a parked question. */
export interface QuestionAnswerPayload {
  /** Echoed from the `question` event. Absent for an inferred question. */
  requestId?: string | null
  /**
   * Chosen option labels, in question order. Multi-select is ONE
   * comma-separated string per question. Positional so the server (which holds
   * the authoritative question text) can zip them without a client mis-keying.
   */
  answers?: string[]
  /**
   * Freeform text the user typed instead of picking. It OUTRANKS `answers` at
   * the CLI level — when set, selections are dropped — so send one or the
   * other, never both. Free text accompanying a choice belongs comma-joined
   * inside that choice's `answers` value.
   */
  response?: string
  /** Dismiss the question without answering it. */
  decline?: boolean
  /** Message shown to the model when `decline` is true. */
  reason?: string
}

/**
 * Question lifecycle carried across events. `processStreamEvent` is pure, so
 * the caller owns this and threads the previous value back in — same contract
 * as `resumePending`.
 */
export interface QuestionState {
  pending: PendingQuestion | null
  /** Outcome of the most recently resolved question, or null if none has. */
  outcome: QuestionOutcome | null
}

export interface ProcessEventResult {
  messages: MessageBlock[]
  isStreaming: boolean
  /** Convenience alias for `question.pending`. */
  pendingQuestion: PendingQuestion | null
  /** Thread this back into the next `processStreamEvent` call. */
  question: QuestionState
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
  onSendInput?: (input: ChatInputPart[], attachments: UploadedAttachment[], options?: SendOptions) => void | Promise<void>
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
  /**
   * How the last question ended, so a resolved card can say *how* rather than
   * defaulting to "Answered" — a timeout or a cancellation is not an answer.
   * Omit it and a resolved card falls back to the generic answered state.
   */
  questionOutcome?: QuestionOutcome | null
  /**
   * `answer` is the human-readable form (echoed in the UI, spoken by voice);
   * `payload` is what to send the backend. The payload is absent only from
   * call sites that have nothing structured to say — treat it as
   * `{ response: answer }` there.
   */
  onAnswerQuestion?: (answer: string, payload?: QuestionAnswerPayload) => void
  onResume?: () => void | Promise<void>
  /** Whether older history exists beyond the currently loaded tail. */
  hasEarlierMessages?: boolean
  /** Load the next older history page while preserving the current viewport. */
  onLoadEarlier?: () => void | Promise<void>
  /** True while an older history page is being fetched. */
  isLoadingEarlier?: boolean
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
  /** Fetch transcript bytes on demand. Closed tool modals never call it. */
  loadTranscriptPayload?: TranscriptPayloadLoader
  /** Optional full-output download URL for payload-backed transcript parts. */
  getTranscriptPayloadDownloadUrl?: (ref: TranscriptPayloadRef) => string
  permissionMode?: string
  onTogglePlanMode?: () => void
  onExecutePlan?: () => void
  enableImageAttachments?: boolean
  enableFileAttachments?: boolean
  attachmentTransport?: AttachmentTransport
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
    hasAttachments: boolean
  }) => React.ReactNode
  renderMessageExtra?: (block: MessageBlock, index: number) => React.ReactNode
  renderSideActions?: (block: MessageBlock, index: number) => React.ReactNode
}
