export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: string
}

export interface ChatEvent {
  type:
    | "system"
    | "thinking"
    | "assistant_text"
    | "tool_use"
    | "tool_result"
    | "result"
    | "status"
  content: string | null
  thinking: string | null
  message_id: string | null
  tool_calls_json: string | null
}

export interface ChatBackend {
  sendMessage(text: string): Promise<{ sessionId: string }>
  subscribe(
    sessionId: string,
    onEvent: (event: ChatEvent) => void
  ): () => void
  getHistory(limit?: number): Promise<ChatMessage[]>
  reset?(): Promise<void>
}

export interface ChatPanelProps {
  backend: ChatBackend
  placeholder?: string
  className?: string
}
