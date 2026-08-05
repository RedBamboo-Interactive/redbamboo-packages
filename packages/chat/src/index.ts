import "./chat.css"

export type {
  MessageBlock,
  MessagePart,
  TranscriptPayloadRef,
  TranscriptPayloadRange,
  TranscriptPayloadChunk,
  TranscriptPayloadLoader,
  ImageAttachment,
  ChatInputPart,
  UploadedAttachment,
  DraftAttachment,
  AttachmentTransport,
  SendOptions,
  ChatEvent,
  ChatBackend,
  ChatPanelProps,
  QuestionOption,
  StructuredQuestion,
  PendingQuestion,
  QuestionOutcome,
  QuestionAnswerPayload,
  QuestionState,
  ProcessEventResult,
  SpeechBackend,
  SpeakOptions,
  ConversationEntry,
  VoiceInputState,
  VoiceInputHandle,
  ExchangeState,
  HandsFreeContextValue,
  SessionStats,
  SessionConfigOption,
  SessionAgentInfo,
  ContextIndicatorProps,
} from "./types"

export { ChatPanel } from "./components/chat-panel"
export { fetchTranscriptPayload } from "./lib/http-transcript-payload"
export { ChatMessage, getPartColor, getSpinnerColor, extractPlanFileContent } from "./components/chat-message"
export { ContextSquare, PendingContextBanner, parseContextFromMessage, extractRawContextXml } from "./components/context-card"
export type { ContextCardData, ContextSquareProps, PendingContextBannerProps } from "./components/context-card"
export { Composer } from "./components/composer"
export { StreamingText, MarkdownRenderer, MediaLightbox } from "./components/streaming-text"
export { MorphSpinner } from "./components/morph-spinner"
export { ToolInputView } from "./components/tool-input-view"
export { ToolOutputView } from "./components/tool-output"
export { EventView, parseEventPart } from "./components/event-view"
export type { ParsedEvent, EventViewProps } from "./components/event-view"
export { ToolCallCard } from "./components/tool-call-card"
export { ContextIndicator } from "./components/context-indicator"
export { SessionStatsModal, getContextPercent, getMaxContext } from "./components/session-stats-modal"
export { StreamingStatusLine } from "./components/streaming-status-line"
export { PendingQuestionLine } from "./components/pending-question-line"
export { HandsFreeStatusLine } from "./components/hands-free-status-line"
export { VoiceInputButton } from "./components/voice-input-button"
export { useChatStream } from "./hooks/use-chat-stream"
export { useVoiceInput } from "./hooks/use-voice-input"
export type { VoiceInputParams } from "./hooks/use-voice-input"
export { useGlobalHandsFree } from "./hooks/use-hands-free"
export type { HandsFreeParams } from "./hooks/use-hands-free"
export { HandsFreeContext, useHandsFree } from "./contexts/hands-free"
export { AudioRecorder } from "./lib/audio-recorder"
export { AudioPlayer } from "./lib/audio-player"
export {
  dispatchGlobalPushToTalk,
  GLOBAL_PUSH_TO_TALK_EVENT,
  parseGlobalPushToTalkDetail,
} from "./lib/global-push-to-talk"
export type { GlobalPushToTalkDetail } from "./lib/global-push-to-talk"
export {
  DEFAULT_PUSH_TO_TALK_KEY,
  PUSH_TO_TALK_SETTINGS_STORAGE_KEY,
  normalizePushToTalkKey,
  pushToTalkSettingsStore,
  usePushToTalkSettings,
} from "./lib/push-to-talk-settings"
export type { PushToTalkSettings } from "./lib/push-to-talk-settings"
export { filterConversation } from "./lib/conversation-filter"
export { createSpeechBackend, createProxySpeechTransport, DEFAULT_REFORMULATE_PROMPT, DEFAULT_SUMMARIZE_PROMPT } from "./lib/speech-backend"
export type { SpeechTransport, PromptRequest, CreateSpeechBackendOptions } from "./lib/speech-backend"
export { processStreamEvent, parseStructuredQuestions } from "./lib/process-stream-event"
export { EVENT_TOOL_PREFIX, isEventPart, isEventBlock, streamTargetIndex } from "./lib/event-parts"
export { getEffectiveToolName } from "./lib/tool-semantics"
export { rebuildBlocks } from "./lib/rebuild-blocks"
export type { PersistedMessage } from "./lib/rebuild-blocks"
export { buildSharePayload } from "./lib/share-payload"
export type { SharePayload, ShareMessage, ShareMetadata } from "./lib/share-payload"
export { canonicalizeChatMediaSrc, resolveChatMediaSrc } from "./lib/media-url"
export type { MediaSrcResolver } from "./lib/media-url"
export { ShareDialog } from "./components/share-dialog"
export type { ShareDialogProps } from "./components/share-dialog"
