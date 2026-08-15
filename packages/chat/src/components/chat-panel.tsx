import { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from "react"
import type { ChatInputPart, ChatPanelProps, ImageAttachment, MessageBlock as MessageBlockType, OutgoingMessageDraft, SendOptions, UploadedAttachment } from "../types"
import { useChatStream } from "../hooks/use-chat-stream"
import { useVoiceInput } from "../hooks/use-voice-input"
import { useMessageQueue } from "../hooks/use-message-queue"
import { ChatMessage, extractPlanFileContent } from "./chat-message"
import { isEventBlock } from "../lib/event-parts"
import { projectActivityTimeline } from "../lib/activity-timeline"
import { Composer, type ComposerHandle } from "./composer"
import { QueuedMessageGhost } from "./queued-message-ghost"
import type { QueuedMessage } from "../lib/message-queue"
import { StreamingStatusLine } from "./streaming-status-line"
import { PendingQuestionLine } from "./pending-question-line"
import { MorphSpinner } from "./morph-spinner"
import { MediaLightbox } from "./streaming-text"

// Windowed rendering: long conversations are read from the tail, so only the
// last WINDOW blocks are mounted. Scrolling up (or the "earlier messages"
// pill) reveals CHUNK more; re-pinning to the bottom releases them again.
const WINDOW = 40
const CHUNK = 80
const CONVERSATION_ENTRANCE_STAGGER_MS = 80

function hasExitPlanPart(block: MessageBlockType): boolean {
  return block.parts.some(p => p.type === "tool_use" && p.toolName === "ExitPlanMode")
}

export function ChatPanel(props: ChatPanelProps) {
  const internal = useChatStream(props.backend ?? null)

  const messages = props.messages ?? internal.messages
  const isStreaming = props.isStreaming ?? internal.isStreaming
  const sendMessage = props.onSend ?? internal.sendMessage
  const sendInput = props.onSendInput ?? internal.sendInput
  const interrupt = props.onInterrupt ?? internal.interrupt
  const pendingQuestion = props.pendingQuestion !== undefined ? props.pendingQuestion : internal.pendingQuestion
  const questionOutcome = props.questionOutcome !== undefined ? props.questionOutcome : internal.questionOutcome
  const interrupting = props.interrupting ?? internal.interrupting
  const resumePending = props.resumePending ?? internal.resumePending
  // Uncontrolled mode answers through the hook, which knows the live requestId.
  const onAnswerQuestion = props.onAnswerQuestion ?? (props.backend ? internal.answerQuestion : undefined)

  const {
    sessionId, queueTransport, disabled = false, hideComposer = false, onResume,
    hasEarlierMessages = false, onLoadEarlier, isLoadingEarlier = false,
    placeholder, className, header, footer,
    resolveImageSrc, resolveFileLink, resolveEventLink, loadTranscriptPayload, getTranscriptPayloadDownloadUrl,
    permissionMode, onTogglePlanMode, onExecutePlan,
    enableImageAttachments, enableFileAttachments, attachmentTransport, draftStorageKey,
    prepareOutgoingMessage,
    speechBackend, handsFreeEnabled, pushToTalkKey, globalPushToTalk,
    renderStatusLine, renderComposerInlineAction, renderAttachmentActions, renderMessageExtra, renderSideActions,
  } = props

  const prepareMessage = useCallback((message: OutgoingMessageDraft): OutgoingMessageDraft => (
    prepareOutgoingMessage ? prepareOutgoingMessage(message) : message
  ), [prepareOutgoingMessage])

  const deliverMessage = useCallback((message: OutgoingMessageDraft, options?: SendOptions) => {
    if (message.attachments?.length) {
      const input: ChatInputPart[] = []
      if (message.content) input.push({ type: "text", text: message.content })
      input.push(...message.attachments.map(attachment => ({ type: "attachment" as const, attachmentId: attachment.id })))
      return Promise.resolve(sendInput(input, message.attachments, options))
    }
    return Promise.resolve(sendMessage(message.content, message.images, options))
  }, [sendInput, sendMessage])

  const voice = useVoiceInput(speechBackend ? {
    speech: speechBackend,
    messages,
    onSend: (content, opts) => deliverMessage(prepareMessage({ content }), opts),
    onAnswerQuestion,
    pendingQuestion: !!pendingQuestion,
    disabled,
    handsFreeEnabled,
    pushToTalkKey,
    globalPushToTalk,
  } : null)

  const composerRef = useRef<ComposerHandle>(null)
  const drainMessage = useCallback((text: string, images?: ImageAttachment[], attachments?: UploadedAttachment[], options?: SendOptions) => (
    deliverMessage({ content: text, images, attachments }, options)
  ), [deliverMessage])
  const messageQueue = useMessageQueue({
    sessionId,
    isStreaming,
    disabled,
    resumePending,
    questionPending: !!pendingQuestion,
    queueTransport,
    onDrain: drainMessage,
    onDiscardAttachments: attachments => {
      if (!attachmentTransport) return
      for (const attachment of attachments) void attachmentTransport.delete(attachment.id).catch(() => {})
    },
  })

  const canonicalUserUids = useMemo(() => new Set(
    messages.filter(message => message.role === "user").map(message => String(message.id)),
  ), [messages])
  const settledUids = useMemo(() => messageQueue.queue.flatMap(item => {
    const uid = item.deliveredMessageUid ?? item.messageUid
    return item.remoteState === "delivered" && uid && canonicalUserUids.has(uid) ? [uid] : []
  }), [canonicalUserUids, messageQueue.queue])
  const settledKey = settledUids.join("\u0000")
  const entranceActivationRef = useRef<{ sessionKey: string | null; shown: boolean }>({
    sessionKey: sessionId ?? null,
    shown: false,
  })
  const entranceSessionKey = sessionId ?? null
  if (entranceActivationRef.current.sessionKey !== entranceSessionKey) {
    entranceActivationRef.current = { sessionKey: entranceSessionKey, shown: false }
  }
  const isConversationEntrance = messages.length > 0 && !entranceActivationRef.current.shown
  useEffect(() => {
    if (messages.length > 0 && entranceActivationRef.current.sessionKey === entranceSessionKey) {
      entranceActivationRef.current.shown = true
    }
  }, [entranceSessionKey, messages.length])
  useLayoutEffect(() => {
    if (settledUids.length > 0) messageQueue.settleDelivered(settledUids)
  }, [messageQueue.settleDelivered, settledKey])
  const visibleOutgoing = useMemo(() => messageQueue.queue.filter(item => {
    const uid = item.deliveredMessageUid ?? item.messageUid
    return !uid || !canonicalUserUids.has(uid)
  }), [canonicalUserUids, messageQueue.queue])

  const enqueueMessage = useCallback((content: string, images?: ImageAttachment[], options?: SendOptions) => {
    const prepared = prepareMessage({ content, images })
    if (prepared.attachments?.length) messageQueue.addInput(prepared.content, prepared.attachments, prepared.images, options)
    else messageQueue.add(prepared.content, prepared.images, options)
  }, [messageQueue, prepareMessage])

  const enqueueInput = useCallback((content: string, attachments: UploadedAttachment[], options?: SendOptions) => {
    const prepared = prepareMessage({ content, attachments })
    if (prepared.attachments?.length) messageQueue.addInput(prepared.content, prepared.attachments, prepared.images, options)
    else messageQueue.add(prepared.content, prepared.images, options)
  }, [messageQueue, prepareMessage])

  const handleEditQueued = useCallback((id: string) => {
    const item = messageQueue.pullback(id)
    if (item) composerRef.current?.loadDraft(item.text, item.images, item.attachments)
  }, [messageQueue])

  const renderQueuedGhost = useCallback((item: QueuedMessage) => (
    <QueuedMessageGhost
      key={`outgoing:${item.id}`}
      item={item}
      onCancel={messageQueue.cancel}
      onEdit={handleEditQueued}
      onSendNow={id => {
        const current = messageQueue.queue.find(message => message.id === id)
        if (current?.deliveryError) messageQueue.retry(id)
        else if (!messageQueue.sendNow()) interrupt()
      }}
    />
  ), [messageQueue.cancel, messageQueue.queue, messageQueue.retry, messageQueue.sendNow, handleEditQueued, interrupt])

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
  const snapToBottomRef = useRef(false)

  // Render-time adjustments (never paint a stale window):
  // - conversation switch → jump to the tail, pinned to the bottom
  // - list grows while pinned → slide the window, releasing old blocks
  // - list shrinks below the window start (clear/reload) → clamp
  if (sessionKey !== prevSessionKey) {
    setPrevSessionKey(sessionKey)
    setPrevLen(messages.length)
    setStartIndex(Math.max(0, messages.length - WINDOW))
    shouldAutoScroll.current = true
    snapToBottomRef.current = true
  } else if (messages.length !== prevLen) {
    setPrevLen(messages.length)
    const tail = Math.max(0, messages.length - WINDOW)
    if (shouldAutoScroll.current) {
      if (startIndex !== tail) setStartIndex(tail)
      snapToBottomRef.current = true
    } else if (startIndex >= messages.length) {
      setStartIndex(tail)
    }
  }

  const startIndexRef = useRef(startIndex)
  startIndexRef.current = startIndex
  const expandAnchorRef = useRef<{ height: number; top: number; messageCount: number; startIndex: number } | null>(null)

  const revealEarlier = useCallback(() => {
    const el = scrollRef.current
    if (!el || expandAnchorRef.current || snapToBottomRef.current) return
    if (startIndexRef.current > 0) {
      expandAnchorRef.current = {
        height: el.scrollHeight,
        top: el.scrollTop,
        messageCount: messages.length,
        startIndex: startIndexRef.current,
      }
      setStartIndex(i => Math.max(0, i - CHUNK))
      return
    }
    if (!hasEarlierMessages || !onLoadEarlier || isLoadingEarlier) return
    expandAnchorRef.current = {
      height: el.scrollHeight,
      top: el.scrollTop,
      messageCount: messages.length,
      startIndex: startIndexRef.current,
    }
    void Promise.resolve(onLoadEarlier()).catch(() => {
      expandAnchorRef.current = null
    })
  }, [hasEarlierMessages, isLoadingEarlier, messages.length, onLoadEarlier])

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
    if (anchor && (messages.length > anchor.messageCount || startIndex !== anchor.startIndex || !hasEarlierMessages)) {
      expandAnchorRef.current = null
      if (el) el.scrollTop = anchor.top + (el.scrollHeight - anchor.height)
    }
  }, [startIndex, sessionKey, messages.length, hasEarlierMessages])

  const lastAssistantIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      // Skip ambient event groups: a host can append one while a response is
      // still streaming, and the live treatment belongs to the response.
      if (messages[i].role === "assistant" && !isEventBlock(messages[i])) return i
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

  const outgoingLayoutKey = visibleOutgoing.map(item => (
    `${item.id}:${item.appearance ?? "queue"}:${item.remoteState ?? "local"}`
  )).join("\u0000")

  // New transcript rows, status lines and outgoing queue bubbles are known
  // during React's layout phase. Keep a pinned viewport at the real tail
  // before the browser can emit a scroll event for the increased content
  // height and incorrectly reinterpret that layout shift as user intent.
  useLayoutEffect(() => {
    if (!shouldAutoScroll.current || !scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, isStreaming, outgoingLayoutKey])

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
    if (!atBottom && el.scrollTop < 300) revealEarlier()
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

  const composerEl = hideComposer ? null : (
    <Composer
      ref={composerRef}
      onSend={enqueueMessage}
      onSendInput={enqueueInput}
      onInterrupt={interrupt}
      submitHandlesInterrupt={messageQueue.remote}
      disabled={disabled}
      isStreaming={isStreaming}
      interrupting={interrupting}
      resumePending={resumePending}
      placeholder={voice.interimTranscript ?? placeholder}
      permissionMode={permissionMode}
      onTogglePlanMode={onTogglePlanMode}
      pendingQuestion={!!pendingQuestion}
      onAnswerQuestion={onAnswerQuestion}
      onResume={onResume}
      sessionId={sessionId}
      enableImageAttachments={enableImageAttachments}
      enableFileAttachments={enableFileAttachments}
      attachmentTransport={attachmentTransport}
      draftStorageKey={draftStorageKey}
      renderInlineAction={inlineAction}
      renderAttachmentActions={renderAttachmentActions}
    />
  )

  if (messages.length === 0 && !header && visibleOutgoing.length === 0 && !isStreaming) {
    return (
      <div data-slot="chat-panel" className={`flex-1 flex flex-col min-h-0 min-w-0 ${className || ""}`}>
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-text-muted">
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
  const timelineRows = projectActivityTimeline(visibleMessages, startIndex)
  const inlineOutgoing = visibleOutgoing.filter(item => item.appearance === "message" || item.remoteState === "delivered")
  const waitingOutgoing = visibleOutgoing.filter(item => item.appearance !== "message" && item.remoteState !== "delivered")
  const inlineTimeline = [
    ...timelineRows.map((row, sequence) => ({
      kind: "message" as const,
      key: `timeline:${row.key}`,
      timestamp: Date.parse(row.block.timestamp),
      sequence,
      row,
    })),
    ...inlineOutgoing.map((item, index) => ({
      kind: "outgoing" as const,
      key: `outgoing:${item.id}`,
      timestamp: Date.parse(item.deliveredAt ?? item.createdAt ?? ""),
      sequence: timelineRows.length + index,
      item,
    })),
  ].sort((left, right) => {
    const leftTime = Number.isFinite(left.timestamp) ? left.timestamp : Number.MAX_SAFE_INTEGER
    const rightTime = Number.isFinite(right.timestamp) ? right.timestamp : Number.MAX_SAFE_INTEGER
    return leftTime - rightTime || left.sequence - right.sequence
  })
  const visualTimeline = [
    ...inlineTimeline,
    { kind: "status" as const, key: "streaming-status" },
    ...waitingOutgoing.map(item => ({ kind: "outgoing" as const, key: `outgoing:${item.id}`, item })),
  ]
  const entranceKeys = visualTimeline.flatMap(visual => visual.kind === "message" ? [visual.key] : [])
  const entranceDelayByKey = new Map(entranceKeys.map((key, index) => [
    key,
    entranceKeys.length <= 1
      ? 0
      : Math.round((entranceKeys.length - 1 - index) * CONVERSATION_ENTRANCE_STAGGER_MS / (entranceKeys.length - 1)),
  ]))

  return (
    <div data-slot="chat-panel" className={`flex-1 flex flex-col min-h-0 min-w-0 relative ${className || ""}`}>
      {header && <div className="shrink-0">{header}</div>}

      {/* The jump control belongs to the history viewport, not the whole chat.
          Composer height is deliberately irrelevant: attachments, textarea
          growth and the mobile keyboard can all resize it independently. */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} onScroll={handleScroll} className="h-full overflow-y-auto overflow-x-hidden py-3">
          <div ref={contentRef} className="max-w-3xl mx-auto px-4 min-w-0">
            {(startIndex > 0 || hasEarlierMessages) && (
              <button
                onClick={revealEarlier}
                disabled={isLoadingEarlier}
                className="w-full flex items-center gap-3 py-2 mb-2 text-[11px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
                title="Show earlier messages"
              >
                <span className="h-px flex-1 bg-overlay-6" />
                <i className={`ph-bold ${isLoadingEarlier ? "ph-spinner animate-spin" : "ph-caret-up"} text-[9px]`} />
                <span>{startIndex > 0 ? `${startIndex} earlier message${startIndex === 1 ? "" : "s"}` : "Earlier messages"}</span>
                <span className="h-px flex-1 bg-overlay-6" />
              </button>
            )}
            {visualTimeline.map((visual) => {
              if (visual.kind === "status") return <div key={visual.key}>{statusLine}</div>
              if (visual.kind === "outgoing") return renderQueuedGhost(visual.item)
              const row = visual.row
              const block = row.block
              const index = row.sourceIndices[row.sourceIndices.length - 1] ?? 0
              const isLastAssistant = row.sourceIndices.includes(lastAssistantIndex)
              const reconcilesAnimatedOutgoing = block.role === "user" && settledUids.includes(String(block.id))
              const senderAgent = block.senderAgentId && props.resolveAgentInfo
                ? props.resolveAgentInfo(block.senderAgentId)
                : undefined
              return (
                <ChatMessage
                  key={visual.key}
                  block={block}
                  // Only the canonical replacement for an outgoing bridge has
                  // already animated. Historical user rows should enter beside
                  // assistant content whenever a conversation is revealed.
                  animateEntrance={isConversationEntrance || !reconcilesAnimatedOutgoing}
                  entranceDelayMs={isConversationEntrance ? entranceDelayByKey.get(visual.key) ?? 0 : 0}
                  blockIndex={index}
                  isStreaming={isStreaming && isLastAssistant}
                  isLastAssistantBlock={isLastAssistant}
                  permissionMode={permissionMode}
                  onExecutePlan={onExecutePlan}
                  planFileContent={hasExitPlanPart(block) ? planFileContent : null}
                  isPendingQuestion={isLastAssistant && !!pendingQuestion}
                  questionOutcome={isLastAssistant ? questionOutcome : undefined}
                  onAnswerQuestion={isLastAssistant && pendingQuestion ? onAnswerQuestion : undefined}
                  resolveImageSrc={resolveImageSrc}
                  resolveFileLink={resolveFileLink}
                  resolveEventLink={resolveEventLink}
                  loadTranscriptPayload={loadTranscriptPayload}
                  getTranscriptPayloadDownloadUrl={getTranscriptPayloadDownloadUrl}
                  assistantAvatar={props.assistantAvatar}
                  senderName={row.ownsSender ? senderAgent?.name : undefined}
                  senderAvatarUrl={row.ownsSender ? senderAgent?.avatarUrl : undefined}
                  renderExtra={row.ownsActions ? renderMessageExtra : undefined}
                  renderSideActions={row.ownsActions ? renderSideActions : undefined}
                  compactAfter={row.compactAfter}
                  showActions={row.ownsActions}
                />
              )
            })}
          </div>
        </div>

        {showScrollBtn && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 right-4 z-10 w-8 h-8 rounded-full bg-overlay-10 hover:bg-overlay-20 flex items-center justify-center transition-colors shadow-lg border border-border-subtle"
            title="Scroll to bottom"
          >
            <i className="ph-bold ph-arrow-down text-xs" />
          </button>
        )}
      </div>

      {footer}
      {composerEl}
      <MediaLightbox />
    </div>
  )
}
