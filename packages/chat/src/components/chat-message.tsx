import { useState, useRef, useEffect } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@redbamboo/ui"
import type { MessageBlock, MessagePart, ImageAttachment } from "../types"
import { StreamingText, MarkdownRenderer } from "./streaming-text"
import { ToolInputView } from "./tool-input-view"
import { ToolOutputView } from "./tool-output-view"

const readOnlyTools = new Set([
  "Read", "Glob", "Grep", "Agent", "WebSearch", "WebFetch",
  "ToolSearch", "CronList", "TodoRead", "Monitor",
  "ExitPlanMode", "EnterPlanMode", "AskUserQuestion",
])

const mutatingTools = new Set([
  "Edit", "Write", "NotebookEdit", "TodoWrite",
  "CronCreate", "CronDelete", "PushNotification",
])

const shellTools = new Set(["Bash", "PowerShell"])

const COLOR = {
  thinking: "#7C4DFF",
  readOnly: "#26A69A",
  mutating: "#D4AA4F",
  shell: "#D4AA4F",
  result: "#3D7A73",
  error: "#E55B5B",
  fallback: "#555",
}

export function getPartColor(part: MessagePart): string {
  if (part.type === "thinking") return COLOR.thinking
  if (part.type === "error") return COLOR.error
  if (part.type === "tool_result") return COLOR.result
  if (part.type === "tool_use" && part.toolName) {
    if (readOnlyTools.has(part.toolName)) return COLOR.readOnly
    if (mutatingTools.has(part.toolName)) return COLOR.mutating
    if (shellTools.has(part.toolName)) return COLOR.shell
  }
  return COLOR.fallback
}

export function getSpinnerColor(messages: MessageBlock[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const block = messages[i]
    if (block.role !== "assistant") continue
    for (let j = block.parts.length - 1; j >= 0; j--) {
      const part = block.parts[j]
      if (part.type === "thinking") return "#7C4DFF"
      if (part.type === "tool_use" && part.toolName) {
        if (readOnlyTools.has(part.toolName)) return "#26A69A"
        if (mutatingTools.has(part.toolName)) return "#D4AA4F"
        if (shellTools.has(part.toolName)) return "#D4AA4F"
      }
      if (part.type === "text") return "#26A69A"
    }
  }
  return "#26A69A"
}

function isPlanFile(path: string): boolean {
  return path.includes(".claude/plans/") || path.includes(".claude\\plans\\")
}

export function extractPlanFileContent(messages: MessageBlock[]): string | null {
  let planContent: string | null = null
  for (const block of messages) {
    if (block.role !== "assistant") continue
    for (const part of block.parts) {
      if (part.type !== "tool_use" || !part.toolInput) continue
      try {
        const input = JSON.parse(part.toolInput)
        if (part.toolName === "Write" && isPlanFile(input.file_path || "")) {
          planContent = input.content || null
        } else if (part.toolName === "Edit" && planContent && isPlanFile(input.file_path || "")) {
          const { old_string, new_string, replace_all } = input
          if (old_string && typeof new_string === "string") {
            planContent = replace_all
              ? planContent.replaceAll(old_string, new_string)
              : planContent.replace(old_string, new_string)
          }
        }
      } catch { /* malformed JSON — skip */ }
    }
  }
  return planContent
}

interface ChatMessageProps {
  block: MessageBlock
  isStreaming?: boolean
  isLastAssistantBlock?: boolean
  permissionMode?: string
  onExecutePlan?: () => void
  planFileContent?: string | null
  isPendingQuestion?: boolean
  onAnswerQuestion?: (answer: string) => void
  resolveImageSrc?: (src: string) => string | undefined
}

export function ChatMessage({
  block,
  isStreaming,
  isLastAssistantBlock,
  permissionMode,
  onExecutePlan,
  planFileContent,
  isPendingQuestion,
  onAnswerQuestion,
  resolveImageSrc,
}: ChatMessageProps) {
  if (block.role === "user") {
    const images = block.parts[0]?.images
    return (
      <div className="flex justify-end mb-3 msg-enter-user">
        <div className="max-w-[80%] bg-white/10 rounded-xl rounded-br-sm px-4 py-2.5">
          {images && images.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-2">
              {images.map((img: ImageAttachment, i: number) => (
                <img
                  key={i}
                  src={`data:${img.mediaType};base64,${img.base64}`}
                  alt=""
                  className="max-h-48 rounded-md border border-white/10"
                />
              ))}
            </div>
          )}
          {block.parts[0]?.content && (
            <p className="text-sm whitespace-pre-wrap break-words font-serif">{block.parts[0].content}</p>
          )}
        </div>
      </div>
    )
  }

  const isLiveBlock = !!isStreaming && !!isLastAssistantBlock
  const groups = groupParts(block.parts, isLiveBlock)
  const hasExitPlanMode = block.parts.some(p => p.type === "tool_use" && p.toolName === "ExitPlanMode")

  const askQuestionPart = block.parts.find(p => p.type === "tool_use" && p.toolName === "AskUserQuestion")
  let questionText: string | null = null
  if (askQuestionPart?.toolInput) {
    try {
      questionText = JSON.parse(askQuestionPart.toolInput).question || null
    } catch { questionText = askQuestionPart.toolInput }
  }

  return (
    <div className="mb-4 min-w-0">
      <div className="max-w-full min-w-0 overflow-hidden">
        {groups.map((group, i) =>
          group.kind === "text" ? (
            <div key={i} className="text-sm leading-relaxed font-serif markdown-body msg-enter-ai">
              {group.parts[0].isPartial ? (
                <StreamingText content={group.parts[0].content} isLive resolveImageSrc={resolveImageSrc} />
              ) : (
                <MarkdownRenderer content={group.parts[0].content} resolveImageSrc={resolveImageSrc} />
              )}
            </div>
          ) : (
            <div key={i} className="msg-enter-ai">
              <PartFrieze parts={group.parts} allParts={block.parts} isLive={group.kind === "frieze" && group.isLive} />
            </div>
          )
        )}
        {hasExitPlanMode && (
          <PlanCard
            onExecute={onExecutePlan}
            permissionMode={permissionMode}
            planText={planFileContent || block.parts.filter(p => p.type === "text").map(p => p.content).join("\n\n")}
            resolveImageSrc={resolveImageSrc}
          />
        )}
        {questionText && (
          <QuestionCard
            question={questionText}
            answered={!isPendingQuestion}
            onAnswer={onAnswerQuestion}
          />
        )}
      </div>
    </div>
  )
}

type PartGroup =
  | { kind: "text"; parts: [MessagePart] }
  | { kind: "frieze"; parts: MessagePart[]; isLive?: boolean }

function groupParts(parts: MessagePart[], isLiveBlock: boolean): PartGroup[] {
  const groups: PartGroup[] = []
  let frieze: MessagePart[] = []

  const flushFrieze = () => {
    if (frieze.length > 0) {
      groups.push({ kind: "frieze", parts: frieze, isLive: isLiveBlock })
      frieze = []
    }
  }

  for (const part of parts) {
    if (part.type === "text") {
      flushFrieze()
      groups.push({ kind: "text", parts: [part] })
    } else {
      frieze.push(part)
    }
  }
  flushFrieze()
  return groups
}

function partLabel(part: MessagePart): string {
  switch (part.type) {
    case "thinking": return "Thinking"
    case "tool_use": return part.toolName || "Tool"
    case "tool_result": return "Result"
    case "error": return "Error"
    default: return part.type
  }
}

function findPairedResult(allParts: MessagePart[], toolUsePart: MessagePart): MessagePart | undefined {
  const idx = allParts.indexOf(toolUsePart)
  if (idx === -1) return undefined
  for (let j = idx + 1; j < allParts.length; j++) {
    if (allParts[j].type === "tool_result") return allParts[j]
    if (allParts[j].type === "tool_use") return undefined
  }
  return undefined
}

function PartFrieze({ parts, allParts, isLive }: { parts: MessagePart[]; allParts: MessagePart[]; isLive?: boolean }) {
  const [selected, setSelected] = useState<{ part: MessagePart; result?: MessagePart } | null>(null)

  const handleClick = (part: MessagePart) => {
    if (part.type === "tool_use") {
      setSelected({ part, result: findPairedResult(allParts, part) })
    } else {
      setSelected({ part })
    }
  }

  return (
    <>
      <div className="flex flex-wrap gap-[3px] py-1.5 px-0.5">
        {parts.filter(p => p.type !== "tool_result").map((part, i) => {
          const inFlight = isLive && !!part.isPartial
          return (
            <button
              key={i}
              onClick={() => handleClick(part)}
              className={`w-2.5 h-2.5 rounded-[2px] transition-all duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer${inFlight ? " square-jiggle" : ""}`}
              style={{ backgroundColor: getPartColor(part) }}
              title={partLabel(part)}
            />
          )
        })}
      </div>

      <PartModal part={selected?.part} pairedResult={selected?.result} open={!!selected} onClose={() => setSelected(null)} />
    </>
  )
}

function toolCategory(part: MessagePart): string | null {
  if (part.type !== "tool_use" || !part.toolName) return null
  if (readOnlyTools.has(part.toolName)) return "read-only"
  if (mutatingTools.has(part.toolName)) return "mutating"
  if (shellTools.has(part.toolName)) return "shell"
  return null
}

function PartModal({ part, pairedResult, open, onClose }: { part?: MessagePart; pairedResult?: MessagePart; open: boolean; onClose: () => void }) {
  if (!part) return null
  const category = toolCategory(part)
  const isToolUse = part.type === "tool_use"
  const resultContent = pairedResult?.content || (isToolUse ? undefined : part.content)
  const isError = part.type === "error" || (pairedResult?.type === "tool_result" && pairedResult.content?.toLowerCase().startsWith("error"))

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) onClose() }}>
      <DialogContent className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
        <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
          <div
            className="w-3 h-3 rounded-[2px]"
            style={{ backgroundColor: getPartColor(part) }}
          />
          <DialogTitle className="text-sm">{partLabel(part)}</DialogTitle>
          {category && (
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/[0.06] text-text-disabled">
              {category}
            </span>
          )}
        </DialogHeader>

        <div className="overflow-y-auto p-4 flex-1 min-h-0">
          {isToolUse && part.toolInput && (
            <div className="mb-3">
              <ToolInputView toolName={part.toolName || "Unknown"} toolInput={part.toolInput} />
            </div>
          )}

          {isToolUse && resultContent && (
            <>
              <div className="border-t border-border-subtle my-3" />
              <div className="text-[10px] uppercase text-text-muted mb-1.5 font-semibold">Output</div>
              <ToolOutputView content={resultContent} isError={isError} />
            </>
          )}

          {isToolUse && !resultContent && part.isPartial && (
            <>
              <div className="border-t border-border-subtle my-3" />
              <p className="text-xs text-text-disabled italic">Running...</p>
            </>
          )}

          {!isToolUse && part.type === "tool_result" && part.content && (
            <ToolOutputView content={part.content} isError={isError} />
          )}

          {!isToolUse && part.type === "error" && part.content && (
            <ToolOutputView content={part.content} isError />
          )}

          {!isToolUse && part.type !== "tool_result" && part.type !== "error" && part.content && (
            <pre className="text-xs font-mono whitespace-pre-wrap break-all">
              {part.content.slice(0, 5000)}{part.content.length > 5000 ? "\n..." : ""}
            </pre>
          )}

          {!part.content && !part.toolInput && (
            <p className="text-sm text-text-muted italic">No content</p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function PlanCard({ onExecute, permissionMode, planText, resolveImageSrc }: {
  onExecute?: () => void
  permissionMode?: string
  planText?: string
  resolveImageSrc?: (src: string) => string | undefined
}) {
  const alreadyExecuting = permissionMode === "bypassPermissions"
  const [showPlan, setShowPlan] = useState(false)

  const mdComponents = {
    img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => {
      const resolved = src && resolveImageSrc ? (resolveImageSrc(src.toString()) ?? src.toString()) : src?.toString()
      return <img src={resolved} alt={alt?.toString() || ""} className="max-w-full rounded" />
    },
  }

  return (
    <>
      <div className="my-3 rounded-lg border border-violet-500/30 bg-violet-500/[0.08] p-3">
        <div className="flex items-center gap-2 mb-2">
          <i className="fa-solid fa-compass-drafting text-sm text-violet-400" />
          <span className="text-sm font-medium text-violet-300">Plan ready for review</span>
        </div>
        <p className="text-xs text-text-muted mb-3">
          Execute the plan, or send a message to revise while staying in plan mode.
        </p>
        <div className="flex items-center gap-2">
          {onExecute && !alreadyExecuting && (
            <button
              onClick={onExecute}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-500/25 hover:bg-violet-500/40 text-violet-200 text-xs font-medium transition-colors"
            >
              <i className="fa-solid fa-play" />
              Execute Plan
            </button>
          )}
          {planText && (
            <button
              onClick={() => setShowPlan(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-500/15 hover:bg-violet-500/30 text-violet-300 text-xs font-medium transition-colors"
            >
              <i className="fa-solid fa-eye" />
              View Plan
            </button>
          )}
          {alreadyExecuting && (
            <span className="flex items-center gap-1.5 text-xs text-text-muted italic">
              <i className="fa-solid fa-check text-xs text-green-400" />
              Plan accepted — executing
            </span>
          )}
        </div>
      </div>

      <Dialog open={showPlan && !!planText} onOpenChange={v => { if (!v) setShowPlan(false) }}>
        <DialogContent className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <i className="fa-solid fa-compass-drafting text-sm text-violet-400" />
            <DialogTitle className="text-sm text-violet-300">Plan</DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto p-5 flex-1 min-h-0 text-sm leading-relaxed font-serif markdown-body">
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={mdComponents} urlTransform={(u: string) => u}>
              {planText}
            </Markdown>
          </div>

          {!alreadyExecuting && onExecute && (
            <div className="px-4 py-3 border-t border-border-subtle shrink-0">
              <button
                onClick={() => { onExecute(); setShowPlan(false) }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-violet-500/25 hover:bg-violet-500/40 text-violet-200 text-sm font-medium transition-colors"
              >
                <Play size={12} />
                Execute Plan
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function QuestionCard({ question, answered, onAnswer }: {
  question: string
  answered: boolean
  onAnswer?: (answer: string) => void
}) {
  const [value, setValue] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!answered && inputRef.current) inputRef.current.focus()
  }, [answered])

  const handleSubmit = () => {
    const trimmed = value.trim()
    if (!trimmed || !onAnswer) return
    onAnswer(trimmed)
    setValue("")
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  return (
    <div className="my-3 rounded-lg border border-teal-500/30 bg-teal-500/[0.08] p-3">
      <div className="flex items-center gap-2 mb-2">
        <i className="fa-solid fa-circle-question text-sm text-teal-400" />
        <span className="text-sm font-medium text-teal-300">Question</span>
      </div>
      <p className="text-sm text-text-primary mb-3 font-serif">{question}</p>
      {answered ? (
        <span className="flex items-center gap-1.5 text-xs text-text-muted italic">
          <i className="fa-solid fa-check text-xs text-green-400" />
          Answered
        </span>
      ) : onAnswer ? (
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type your answer..."
            rows={1}
            className="flex-1 resize-none bg-white/[0.06] rounded-md px-3 py-2 text-sm font-serif placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-teal-500/50"
          />
          <button
            onClick={handleSubmit}
            disabled={!value.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-teal-500/25 hover:bg-teal-500/40 text-teal-200 text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-paper-plane" />
            Answer
          </button>
        </div>
      ) : null}
    </div>
  )
}
