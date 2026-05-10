import "./chat.css"

export type {
  MessageBlock,
  MessagePart,
  ImageAttachment,
  ChatEvent,
  ChatBackend,
  ChatPanelProps,
  SpeechBackend,
  SpeakOptions,
  ConversationEntry,
  VoiceInputState,
  VoiceInputHandle,
  ExchangeState,
  HandsFreeContextValue,
} from "./types"

export { ChatPanel } from "./components/chat-panel"
export { ChatMessage, getPartColor, getSpinnerColor, extractPlanFileContent } from "./components/chat-message"
export { Composer } from "./components/composer"
export { StreamingText, MarkdownRenderer } from "./components/streaming-text"
export { MorphSpinner } from "./components/morph-spinner"
export { ToolInputView } from "./components/tool-input-view"
export { ToolOutputView } from "./components/tool-output-view"
export { ToolCallCard } from "./components/tool-call-card"
export { StreamingStatusLine } from "./components/streaming-status-line"
export { useChatStream } from "./hooks/use-chat-stream"
export { useVoiceInput } from "./hooks/use-voice-input"
export { useGlobalHandsFree } from "./hooks/use-hands-free"
export type { HandsFreeParams } from "./hooks/use-hands-free"
export { HandsFreeContext, useHandsFree } from "./contexts/hands-free"
export { AudioRecorder } from "./lib/audio-recorder"
export { AudioPlayer } from "./lib/audio-player"
export { filterConversation } from "./lib/conversation-filter"
export { createSpeechBackend, DEFAULT_REFORMULATE_PROMPT, DEFAULT_SUMMARIZE_PROMPT } from "./lib/speech-backend"
export type { SpeechTransport, PromptRequest, CreateSpeechBackendOptions } from "./lib/speech-backend"
