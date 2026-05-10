import { useEffect, useRef, useState, useCallback, useMemo } from "react"
import { ArrowDown, Terminal } from "lucide-react"
import type { ChatPanelProps, MessageBlock as MessageBlockType } from "../types"
import { useChatStream } from "../hooks/use-chat-stream"
import { ChatMessage, getSpinnerColor, extractPlanFileContent } from "./chat-message"
import { Composer } from "./composer"
import { MorphSpinner } from "./morph-spinner"

export function ChatPanel({
  backend,
  placeholder,
  className,
  header,
  resolveImageSrc,
  permissionMode,
  onTogglePlanMode,
  onExecutePlan,
  renderStatusLine,
  renderComposerInlineAction,
}: ChatPanelProps) {
  const { messages, isStreaming, sendMessage, interrupt } = useChatStream(backend)
  const scrollRef = useRef<HTMLDivElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const spinnerColor = useMemo(() => getSpinnerColor(messages), [messages])
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

  if (messages.length === 0 && !header) {
    return (
      <div className={`flex-1 flex flex-col min-h-0 min-w-0 ${className || ""}`}>
        <div className="flex-1 flex items-center justify-center text-text-muted">
          <div className="text-center">
            <Terminal size={28} className="mx-auto mb-3 opacity-30" />
            <p className="text-sm">Send a message to get started</p>
          </div>
        </div>
        <Composer
          onSend={sendMessage}
          onInterrupt={interrupt}
          disabled={false}
          isStreaming={isStreaming}
          placeholder={placeholder}
          permissionMode={permissionMode}
          onTogglePlanMode={onTogglePlanMode}
          renderInlineAction={renderComposerInlineAction}
        />
      </div>
    )
  }

  return (
    <div className={`flex-1 flex flex-col min-h-0 min-w-0 relative ${className || ""}`}>
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
                resolveImageSrc={resolveImageSrc}
              />
            )
          })}
          {renderStatusLine ? (
            renderStatusLine({ isStreaming, messages })
          ) : isStreaming ? (
            <div className="flex items-center gap-2.5 text-text-muted text-sm py-1">
              <MorphSpinner color={spinnerColor} />
              <span>Responding...</span>
            </div>
          ) : null}
        </div>
      </div>

      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-20 right-6 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors shadow-lg border border-border-subtle"
          title="Scroll to bottom"
        >
          <ArrowDown size={12} />
        </button>
      )}

      <Composer
        onSend={sendMessage}
        onInterrupt={interrupt}
        disabled={false}
        isStreaming={isStreaming}
        placeholder={placeholder}
        permissionMode={permissionMode}
        onTogglePlanMode={onTogglePlanMode}
        renderInlineAction={renderComposerInlineAction}
      />
    </div>
  )
}
