import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react"
import type { ChatPanelProps, MessageBlock as MessageBlockType } from "../types"
import { useChatStream } from "../hooks/use-chat-stream"
import { useVoiceInput } from "../hooks/use-voice-input"
import { ChatMessage, extractPlanFileContent } from "./chat-message"
import { Composer } from "./composer"
import { StreamingStatusLine } from "./streaming-status-line"
import { PendingQuestionLine } from "./pending-question-line"
import { MorphSpinner } from "./morph-spinner"
import { MediaLightbox } from "./streaming-text"

// Windowed rendering: long conversations are read from the tail, so only the
// last WINDOW blocks are mounted. Scrolling up (or the "earlier messages"
// pill) reveals CHUNK more; re-pinning to the bottom releases them again.
const WINDOW = 40
const CHUNK = 80

function hasExitPlanPart(block: MessageBlockType): boolean {
  return block.parts.some(p => p.type === "tool_use" && p.toolName === "ExitPlanMode")
}

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
    resolveImageSrc, resolveFileLink, resolveEventLink, permissionMode, onTogglePlanMode, onExecutePlan,
    enableImageAttachments, enableFileAttachments, draftStorageKey,
    speechBackend, handsFreeEnabled, pushToTalkKey,
    renderStatusLine, renderComposerInlineAction, renderMessageExtra, renderSideActions,
  } = props

  const voice = useVoiceInput(speechBackend ? {
    speech: speechBackend,
    messages,
    onSend: (content, opts) => sendMessage(content, undefined, opts),
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

  // --- Render window over the message list ---
  const [startIndex, setStartIndex] = useState(() => Math.max(0, messages.length - WINDOW))
  const sessionKey = sessionId ?? null
  const [prevSessionKey, setPrevSessionKey] = useState(sessionKey)
  const [prevLen, setPrevLen] = useState(messages.length)

  // Render-time adjustments (never paint a stale window):
  // - conversation switch → jump to the tail, pinned to the bottom
  // - list grows while pinned → slide the window, releasing old blocks
  // - list shrinks below the window start (clear/reload) → clamp
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    setPrevLen(messages.length)
    setStartIndex(Math.max(0, messages.length - WINDOW))
    shouldAutoScroll.current = true
  } else if (messages.length !== prevLen) {
    setPrevLen(messages.length)
    const tail = Math.max(0, messages.length - WINDOW)
    if (shouldAutoScroll.current) {
      if (startIndex !== tail) setStartIndex(tail)
    } else if (startIndex >= messages.length) {
      setStartIndex(tail)
    }
  }

  const startIndexRef = useRef(startIndex)
  startIndexRef.current = startIndex
  const expandAnchorRef = useRef<{ height: number; top: number } | null>(null)
  const snapToBottomRef = useRef(false)

  const revealEarlier = useCallback(() => {
    const el = scrollRef.current
    if (!el || startIndexRef.current === 0 || expandAnchorRef.current || snapToBottomRef.current) return
    expandAnchorRef.current = { height: el.scrollHeight, top: el.scrollTop }
    setStartIndex(i => Math.max(0, i - CHUNK))
  }, [])

  // After a window change: keep the viewport anchored on the previously-visible
  // message when older ones are prepended above it, or jump to the bottom when
  // the window just snapped back to the tail.
  useLayoutEffect(() => {
    const el = scrollRef.current
    // Snap wins over a pending anchor restore: when both were queued in the
    // same batch (reveal then scroll-to-bottom), the click is the later intent.
    if (snapToBottomRef.current) {
      snapToBottomRef.current = false
      expandAnchorRef.current = null
      if (el) el.scrollTop = el.scrollHeight
      return
    }
    const anchor = expandAnchorRef.current
    if (anchor) {
      expandAnchorRef.current = null
      if (el) el.scrollTop = anchor.top + (el.scrollHeight - anchor.height)
    }
  }, [startIndex])

  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i
    }
    return -1
  }, [messages])

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
    if (el.scrollTop < 300) revealEarlier()
  }, [revealEarlier])

  const messageCountRef = useRef(messages.length)
  messageCountRef.current = messages.length
  const scrollToBottom = useCallback(() => {
    shouldAutoScroll.current = true
    setShowScrollBtn(false)
    const tail = Math.max(0, messageCountRef.current - WINDOW)
    if (startIndexRef.current !== tail) {
      // History was revealed: the DOM above the viewport is about to be
      // released, so a smooth scroll started now would animate toward a stale
      // scrollHeight (and pass through the near-top zone, re-triggering
      // revealEarlier). Snap the window and jump in the layout effect instead,
      // after the re-render, with revealEarlier suppressed until then.
      snapToBottomRef.current = true
      setStartIndex(tail)
    } else {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
    }
  }, [])

  const defaultVoiceAction = !speechBackend ? null : (
    { value, isStreaming: streaming, hasImages }: { value: string; isStreaming: boolean; disabled: boolean; hasImages: boolean },
  ) => {
    if (value.trim() || hasImages || streaming) return null
    const isActive = voice.state !== "idle"
    const voiceLabel = voice.state === "recording"
      ? "Recording"
      : voice.state === "processing"
        ? voice.interimTranscript ? "Refining" : "Transcribing"
        : voice.state === "error"
          ? "Error"
          : null
    return (
      <button
        onPointerDown={(e) => { e.preventDefault(); voice.startRecording() }}
        onPointerUp={(e) => { e.preventDefault(); voice.stopRecording() }}
        onPointerLeave={(e) => { e.preventDefault(); if (voice.state === "recording") voice.cancelRecording() }}
        disabled={disabled || voice.state === "processing"}
        className={`absolute right-2 bottom-1.5 flex items-center justify-center rounded-md transition-all select-none touch-none disabled:opacity-30 disabled:cursor-not-allowed ${
          isActive ? "gap-1.5 px-2.5 h-7" : "w-7 h-7"
        } ${
          voice.state === "recording"
            ? "bg-red-500-a30 text-red-400"
            : voice.state === "processing"
              ? "bg-amber-500-a20 text-amber-400"
              : voice.state === "error"
                ? "bg-red-500-a20 text-red-400"
                : "text-muted-a50 hover:text-text-muted hover:bg-overlay-6"
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
          <i className="ph-bold ph-warning text-xs" />
        ) : (
          <i className="ph-bold ph-microphone text-xs" />
        )}
        {voiceLabel && <span className="text-xs font-medium">{voiceLabel}</span>}
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
      placeholder={voice.interimTranscript ?? placeholder}
      permissionMode={permissionMode}
      onTogglePlanMode={onTogglePlanMode}
      pendingQuestion={!!pendingQuestion}
      onAnswerQuestion={onAnswerQuestion}
      onResume={onResume}
      sessionId={sessionId}
      enableImageAttachments={enableImageAttachments}
      enableFileAttachments={enableFileAttachments}
      draftStorageKey={draftStorageKey}
      renderInlineAction={inlineAction}
    />
  )

  if (messages.length === 0 && !header) {
    return (
      <div data-slot="chat-panel" className={`flex-1 flex flex-col min-h-0 min-w-0 ${className || ""}`}>
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <div className="text-center">
            <i className="ph ph-terminal-window text-3xl mx-auto mb-3 opacity-30" />
            <p className="text-sm">Send a message to get started</p>
          </div>
        </div>
        {footer}
        {composerEl}
      </div>
    )
  }

  const visibleMessages = startIndex > 0 ? messages.slice(startIndex) : messages

  return (
    <div data-slot="chat-panel" className={`flex-1 flex flex-col min-h-0 min-w-0 relative ${className || ""}`}>
      {header && <div className="shrink-0">{header}</div>}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto overflow-x-hidden py-3">
        <div ref={contentRef} className="max-w-3xl mx-auto px-4 min-w-0">
          {startIndex > 0 && (
            <button
              onClick={revealEarlier}
              className="w-full flex items-center gap-3 py-2 mb-2 text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
              title="Show earlier messages"
            >
              <span className="h-px flex-1 bg-overlay-6" />
              <i className="ph-bold ph-caret-up text-[9px]" />
              <span>{startIndex} earlier message{startIndex === 1 ? "" : "s"}</span>
              <span className="h-px flex-1 bg-overlay-6" />
            </button>
          )}
          {visibleMessages.map((block: MessageBlockType, i: number) => {
            const index = startIndex + i
            const isLastAssistant = index === lastAssistantIndex
            const senderAgent = block.senderAgentId && props.resolveAgentInfo
              ? props.resolveAgentInfo(block.senderAgentId)
              : undefined
            return (
              <ChatMessage
                key={block.id}
                block={block}
                blockIndex={index}
                isStreaming={isStreaming && isLastAssistant}
                isLastAssistantBlock={isLastAssistant}
                permissionMode={permissionMode}
                onExecutePlan={onExecutePlan}
                planFileContent={hasExitPlanPart(block) ? planFileContent : null}
                isPendingQuestion={isLastAssistant && !!pendingQuestion}
                onAnswerQuestion={isLastAssistant && pendingQuestion ? onAnswerQuestion : undefined}
                resolveImageSrc={resolveImageSrc}
                resolveFileLink={resolveFileLink}
                resolveEventLink={resolveEventLink}
                assistantAvatar={props.assistantAvatar}
                senderName={senderAgent?.name}
                senderAvatarUrl={senderAgent?.avatarUrl}
                renderExtra={renderMessageExtra}
                renderSideActions={renderSideActions}
              />
            )
          })}
          {statusLine}
        </div>
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 right-6 w-8 h-8 rounded-full bg-overlay-10 hover:bg-overlay-20 flex items-center justify-center transition-colors shadow-lg border border-border-subtle"
          title="Scroll to bottom"
        >
          <i className="ph-bold ph-arrow-down text-xs" />
        </button>
      )}

      {footer}
      {composerEl}
      <MediaLightbox />
    </div>
  )
}
