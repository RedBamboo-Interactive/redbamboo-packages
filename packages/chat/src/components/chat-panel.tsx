import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import type { ChatPanelProps, MessageBlock as MessageBlockType } from "../types"
import { useChatStream } from "../hooks/use-chat-stream"
import { useVoiceInput } from "../hooks/use-voice-input"
import { ChatMessage, extractPlanFileContent } from "./chat-message"
import { Composer } from "./composer"
import { StreamingStatusLine } from "./streaming-status-line"
import { PendingQuestionLine } from "./pending-question-line"
import { MorphSpinner } from "./morph-spinner"

export function ChatPanel(props: ChatPanelProps) {
  const internal = useChatStream(props.backend ?? null)

  const messages = props.messages ?? internal.messages
  const isStreaming = props.isStreaming ?? internal.isStreaming
  const sendMessage = props.onSend ?? internal.sendMessage
  const interrupt = props.onInterrupt ?? internal.interrupt
  const pendingQuestion = props.pendingQuestion !== undefined ? props.pendingQuestion : internal.pendingQuestion

  const {
    sessionId, disabled = false, onAnswerQuestion, onResume,
    placeholder, className, header, footer,
    resolveImageSrc, permissionMode, onTogglePlanMode, onExecutePlan,
    enableImageAttachments, enableFileAttachments,
    speechBackend, handsFreeEnabled, pushToTalkKey,
    renderStatusLine, renderComposerInlineAction,
  } = props

  const voice = useVoiceInput(speechBackend ? {
    speech: speechBackend,
    messages,
    onSend: (content) => sendMessage(content),
    onAnswerQuestion,
    pendingQuestion: !!pendingQuestion,
    disabled,
    handsFreeEnabled,
    pushToTalkKey,
  } : null)

  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const planFileContent = useMemo(() => extractPlanFileContent(messages), [messages])

  const scrollToEnd = useCallback(() => {
    if (!shouldAutoScroll.current || !scrollRef.current) return
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    })
  }, [])

  useEffect(() => { scrollToEnd() }, [messages, isStreaming, scrollToEnd])

  useEffect(() => {
    const content = contentRef.current
    const scroller = scrollRef.current
    if (!content) return

    const observer = new ResizeObserver(() => { scrollToEnd() })
    observer.observe(content)
    if (scroller) observer.observe(scroller)
    return () => observer.disconnect()
  }, [scrollToEnd])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    shouldAutoScroll.current = atBottom
    setShowScrollBtn(!atBottom)
  }, [])

  const scrollToBottom = useCallback(() => {
    shouldAutoScroll.current = true
    setShowScrollBtn(false)
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [])

  const defaultVoiceAction = !speechBackend ? null : (
    { value, isStreaming: streaming, hasImages }: { value: string; isStreaming: boolean; disabled: boolean; hasImages: boolean },
  ) => {
    if (value.trim() || hasImages || streaming) return null
    return (
      <button
        onPointerDown={(e) => { e.preventDefault(); voice.startRecording() }}
        onPointerUp={(e) => { e.preventDefault(); voice.stopRecording() }}
        onPointerLeave={(e) => { e.preventDefault(); if (voice.state === "recording") voice.cancelRecording() }}
        disabled={disabled || voice.state === "processing"}
        className={`absolute right-2 bottom-1.5 w-7 h-7 flex items-center justify-center rounded-md transition-colors select-none touch-none disabled:opacity-30 disabled:cursor-not-allowed ${
          voice.state === "recording"
            ? "bg-red-500/30 text-red-400"
            : voice.state === "processing"
              ? "bg-amber-500/20 text-amber-400"
              : voice.state === "error"
                ? "bg-red-500/20 text-red-400"
                : "text-text-muted/50 hover:text-text-muted hover:bg-contrast/[0.06]"
        }`}
        title="Hold to talk"
      >
        {voice.state === "recording" ? (
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
        ) : voice.state === "processing" ? (
          <MorphSpinner color="#fbbf24" />
        ) : voice.state === "error" ? (
          <i className="fa-solid fa-triangle-exclamation text-xs" />
        ) : (
          <i className="fa-solid fa-microphone text-xs" />
        )}
      </button>
    )
  }

  const inlineAction = renderComposerInlineAction ?? defaultVoiceAction ?? undefined

  const statusLine = renderStatusLine
    ? renderStatusLine({ isStreaming, messages, pendingQuestion: pendingQuestion ?? null })
    : isStreaming
      ? <StreamingStatusLine isStreaming={isStreaming} messages={messages} />
      : pendingQuestion
        ? <PendingQuestionLine />
        : null

  const composerEl = (
    <Composer
      onSend={sendMessage}
      onInterrupt={interrupt}
      disabled={disabled}
      isStreaming={isStreaming}
      placeholder={placeholder}
      permissionMode={permissionMode}
      onTogglePlanMode={onTogglePlanMode}
      pendingQuestion={!!pendingQuestion}
      onAnswerQuestion={onAnswerQuestion}
      onResume={onResume}
      sessionId={sessionId}
      enableImageAttachments={enableImageAttachments}
      enableFileAttachments={enableFileAttachments}
      renderInlineAction={inlineAction}
    />
  )

  if (messages.length === 0 && !header) {
    return (
      <div data-slot="chat-panel" className={`flex-1 flex flex-col min-h-0 min-w-0 ${className || ""}`}>
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <div className="text-center">
            <i className="fa-regular fa-square-terminal text-3xl mx-auto mb-3 opacity-30" />
            <p className="text-sm">Send a message to get started</p>
          </div>
        </div>
        {composerEl}
        {footer}
      </div>
    )
  }

  return (
    <div data-slot="chat-panel" className={`flex-1 flex flex-col min-h-0 min-w-0 relative ${className || ""}`}>
      {header && <div className="shrink-0">{header}</div>}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden py-3">
        <div ref={contentRef} className="max-w-3xl mx-auto px-4 min-w-0">
          {messages.map((block: MessageBlockType, index: number) => {
            const isLastAssistant = block.role === "assistant" &&
              !messages.slice(index + 1).some((b: MessageBlockType) => b.role === "assistant")
            return (
              <ChatMessage
                key={block.id}
                block={block}
                isStreaming={isStreaming}
                isLastAssistantBlock={isLastAssistant}
                permissionMode={permissionMode}
                onExecutePlan={onExecutePlan}
                planFileContent={planFileContent}
                isPendingQuestion={isLastAssistant && !!pendingQuestion}
                onAnswerQuestion={isLastAssistant && pendingQuestion ? onAnswerQuestion : undefined}
                resolveImageSrc={resolveImageSrc}
              />
            )
          })}
          {statusLine}
        </div>
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 right-6 w-8 h-8 rounded-full bg-contrast/10 hover:bg-contrast/20 flex items-center justify-center transition-colors shadow-lg border border-border-subtle"
          title="Scroll to bottom"
        >
          <i className="fa-solid fa-arrow-down text-xs" />
        </button>
      )}

      {composerEl}
      {footer}
    </div>
  )
}
