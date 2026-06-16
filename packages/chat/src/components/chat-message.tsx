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
import type { MessageBlock, MessagePart, ImageAttachment, StructuredQuestion } from "../types"
import { StreamingText, MarkdownRenderer } from "./streaming-text"
import { Emojify } from "./emojify"
import { ContextSquare, parseContextFromMessage, extractRawContextXml } from "./context-card"
import { rehypeTwemoji } from "../lib/rehype-twemoji"
import { ToolInputView } from "./tool-input-view"
import { ToolOutputView } from "./tool-output-view"
import { parseStructuredQuestions } from "../lib/process-stream-event"

const readOnlyTools = new Set([
  "read", "glob", "grep", "agent", "websearch", "webfetch",
  "toolsearch", "cronlist", "todoread", "monitor",
  "exitplanmode", "enterplanmode", "askuserquestion",
  "list", "codesearch", "explore",
])

const mutatingTools = new Set([
  "edit", "write", "notebookedit", "todowrite",
  "croncreate", "crondelete", "pushnotification",
])

const shellTools = new Set(["bash", "powershell"])

function matchTool(set: Set<string>, name?: string): boolean {
  return !!name && set.has(name.toLowerCase())
}

const COLOR = {
  thinking: "var(--color-accent-purple)",
  readOnly: "var(--color-accent-teal)",
  mutating: "var(--color-accent-gold)",
  shell: "var(--color-accent-gold)",
  result: "color-mix(in oklch, var(--color-accent-teal), black 30%)",
  error: "var(--color-accent-red)",
  nova: "rgb(236 72 153)",
  fallback: "var(--color-text-disabled)",
}

interface TaskNotification {
  taskId: string
  status: string
  summary: string
  outputFile: string
}

function parseTaskNotification(content: string): TaskNotification | null {
  if (!content.includes("<task-notification>")) return null
  return {
    taskId: content.match(/<task-id>(.*?)<\/task-id>/s)?.[1]?.trim() || "",
    status: content.match(/<status>(.*?)<\/status>/s)?.[1]?.trim() || "",
    summary: content.match(/<summary>(.*?)<\/summary>/s)?.[1]?.trim() || "Background task",
    outputFile: content.match(/<output-file>(.*?)<\/output-file>/s)?.[1]?.trim() || "",
  }
}

interface NovaEvent {
  source: string
  type: string
  content: string
}

function parseNovaEvent(content: string): NovaEvent | null {
  if (!content.includes("<nova-event")) return null
  const match = content.match(/<nova-event\s+([^>]*)>([\s\S]*?)<\/nova-event>/)
  if (!match) return null
  const attrs = match[1]
  return {
    source: attrs.match(/source="([^"]*)"/)  ?.[1] || "automation",
    type: attrs.match(/type="([^"]*)"/)  ?.[1] || "generic",
    content: match[2].trim(),
  }
}

function novaEventIcon(type: string): string {
  switch (type) {
    case "http-check": return "fa-solid fa-satellite-dish"
    case "ai-session": return "fa-solid fa-brain"
    default: return "fa-solid fa-bolt"
  }
}

export function getPartColor(part: MessagePart): string {
  if (part.type === "thinking") return COLOR.thinking
  if (part.type === "error") return COLOR.error
  if (part.type === "tool_result") return COLOR.result
  if (part.type === "tool_use" && part.toolName) {
    if (matchTool(readOnlyTools, part.toolName)) return COLOR.readOnly
    if (matchTool(mutatingTools, part.toolName)) return COLOR.mutating
    if (matchTool(shellTools, part.toolName)) return COLOR.shell
  }
  return COLOR.fallback
}

export function getSpinnerColor(messages: MessageBlock[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const block = messages[i]
    if (block.role !== "assistant") continue
    for (let j = block.parts.length - 1; j >= 0; j--) {
      const part = block.parts[j]
      if (part.type === "thinking") return COLOR.thinking
      if (part.type === "tool_use" && part.toolName) {
        if (matchTool(readOnlyTools, part.toolName)) return COLOR.readOnly
        if (matchTool(mutatingTools, part.toolName)) return COLOR.mutating
        if (matchTool(shellTools, part.toolName)) return COLOR.shell
      }
      if (part.type === "text") return COLOR.readOnly
    }
  }
  return COLOR.readOnly
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
  resolveFileLink?: (filePath: string, opts?: { line?: number }) => (() => void) | undefined
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
  resolveFileLink,
}: ChatMessageProps) {
  if (block.role === "user") {
    const rawContent = block.parts[0]?.content || ""
    const content = rawContent
      .replace(/<nova-context[\s\S]*?<\/nova-context>\s*/g, "")
      .replace(/<nova-prior-messages[\s\S]*?<\/nova-prior-messages>\s*/g, "")
    const notification = parseTaskNotification(rawContent)
    if (notification) {
      return <TaskNotificationSquare notification={notification} />
    }

    const novaEvent = parseNovaEvent(rawContent)
    if (novaEvent) {
      return <NovaEventSquare event={novaEvent} />
    }

    const contextData = parseContextFromMessage(rawContent)
    const contextXml = contextData ? extractRawContextXml(rawContent) : undefined
    const contextScreenshot = block.parts[0]?.images?.[0]
    const nonContextImages = block.parts[0]?.images?.slice(contextData ? 1 : 0)

    if (contextData && !content && (!nonContextImages || nonContextImages.length === 0)) {
      return <ContextSquare context={{ ...contextData, screenshot: contextScreenshot }} rawXml={contextXml} />
    }

    return (
      <div className="mb-3 msg-enter-user group/msg">
        {contextData && (
          <ContextSquare context={{ ...contextData, screenshot: contextScreenshot }} rawXml={contextXml} />
        )}
        <div className="flex justify-end">
          <div className="relative max-w-[80%] bg-overlay-10 rounded-xl rounded-br-sm px-4 py-2.5">
            <MessageMetadata block={block} />
            {nonContextImages && nonContextImages.length > 0 && (
              <div className="flex flex-wrap gap-2 mb-2">
                {nonContextImages.map((img: ImageAttachment, i: number) => (
                  <img
                    key={i}
                    src={`data:${img.mediaType};base64,${img.base64}`}
                    alt=""
                    className="max-h-48 rounded-md border border-overlay-10"
                  />
                ))}
              </div>
            )}
            {content && (
              <p className="text-sm whitespace-pre-wrap break-words font-serif"><Emojify text={content} /></p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const isLiveBlock = !!isStreaming && !!isLastAssistantBlock
  const groups = groupParts(block.parts, isLiveBlock)
  const hasExitPlanMode = block.parts.some(p => p.type === "tool_use" && p.toolName === "ExitPlanMode")

  const askQuestionPart = block.parts.find(p => p.type === "tool_use" && p.toolName === "AskUserQuestion")
  let questionText: string | null = null
  let structuredQuestions: StructuredQuestion[] | null = null
  if (askQuestionPart?.toolInput && !askQuestionPart.isPartial) {
    try {
      const parsed = JSON.parse(askQuestionPart.toolInput)
      const sq = parseStructuredQuestions(parsed)
      if (sq) {
        questionText = sq[0].question || "Claude is asking a question..."
        structuredQuestions = sq
      } else if (parsed.question) {
        questionText = parsed.question
      }
    } catch { questionText = askQuestionPart.toolInput }
  }

  return (
    <div className="mb-4 min-w-0 group/msg">
      <div className="relative max-w-full min-w-0 overflow-hidden">
        {!isLiveBlock && <MessageMetadata block={block} />}
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
              <PartFrieze parts={group.parts} allParts={block.parts} isLive={group.kind === "frieze" && group.isLive} resolveFileLink={resolveFileLink} />
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
            questions={structuredQuestions}
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

function PartFrieze({ parts, allParts, isLive, resolveFileLink }: {
  parts: MessagePart[]
  allParts: MessagePart[]
  isLive?: boolean
  resolveFileLink?: (filePath: string, opts?: { line?: number }) => (() => void) | undefined
}) {
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
              className={`w-2.5 h-2.5 rounded-[2px] transition-colors duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer${inFlight ? " square-jiggle" : " square-spawn"}`}
              style={{ backgroundColor: getPartColor(part) }}
              title={partLabel(part)}
            />
          )
        })}
      </div>

      <PartModal part={selected?.part} pairedResult={selected?.result} open={!!selected} onClose={() => setSelected(null)} resolveFileLink={resolveFileLink} />
    </>
  )
}

function toolCategory(part: MessagePart): string | null {
  if (part.type !== "tool_use" || !part.toolName) return null
  if (matchTool(readOnlyTools, part.toolName)) return "read-only"
  if (matchTool(mutatingTools, part.toolName)) return "mutating"
  if (matchTool(shellTools, part.toolName)) return "shell"
  return null
}

// Grep/Glob `path` may be a directory — hosts are expected to handle both.
const fileTools = new Set(["read", "write", "edit", "multiedit", "notebookedit", "grep", "glob"])

/** File path (and line, when the tool input implies one) targeted by a file tool call. */
function extractToolFile(part: MessagePart): { path: string; line?: number } | null {
  if (part.type !== "tool_use" || !part.toolName || !part.toolInput) return null
  if (!fileTools.has(part.toolName.toLowerCase())) return null
  try {
    const input = JSON.parse(part.toolInput) as Record<string, unknown>
    const path = input.file_path ?? input.notebook_path ?? input.path
    if (typeof path !== "string" || !path) return null
    // Read's offset is the 1-based line the read started from.
    const line = typeof input.offset === "number" && input.offset > 0 ? input.offset : undefined
    return { path, line }
  } catch {
    return null
  }
}

function PartModal({ part, pairedResult, open, onClose, resolveFileLink }: {
  part?: MessagePart
  pairedResult?: MessagePart
  open: boolean
  onClose: () => void
  resolveFileLink?: (filePath: string, opts?: { line?: number }) => (() => void) | undefined
}) {
  if (!part) return null
  const category = toolCategory(part)
  const isToolUse = part.type === "tool_use"
  const resultContent = pairedResult?.content || (isToolUse ? undefined : part.content)
  const isError = part.type === "error" || (pairedResult?.type === "tool_result" && pairedResult.content?.toLowerCase().startsWith("error"))

  const toolFile = resolveFileLink ? extractToolFile(part) : null
  const openFile = toolFile ? resolveFileLink?.(toolFile.path, { line: toolFile.line }) : undefined

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
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-disabled">
              {category}
            </span>
          )}
          {openFile && (
            <button
              onClick={() => { onClose(); openFile() }}
              className="ml-auto mr-7 inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-overlay-6 text-text-muted hover:bg-overlay-10 hover:text-contrast transition-colors"
              title={`Open ${toolFile!.path} in the editor`}
            >
              <i className="fa-regular fa-code text-[11px]" />
              Open
            </button>
          )}
        </DialogHeader>

        <div className="overflow-y-auto p-4 flex-1 min-h-0">
          {isToolUse && part.toolInput && (
            <div className="mb-3">
              <ToolInputView
                toolName={part.toolName || "Unknown"}
                toolInput={part.toolInput}
                onOpenFile={openFile ? () => { onClose(); openFile() } : undefined}
              />
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
            part.type === "thinking" ? (
              <div className="text-sm leading-relaxed font-serif markdown-body">
                <MarkdownRenderer content={part.content} />
              </div>
            ) : (
              <pre className="text-xs font-mono whitespace-pre-wrap break-all">
                {part.content.slice(0, 5000)}{part.content.length > 5000 ? "\n..." : ""}
              </pre>
            )
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
      <div className="my-3 rounded-lg border border-violet-500-a30 bg-violet-500-a8 p-3">
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
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-500-a25 hover:bg-violet-500-a40 text-violet-200 text-xs font-medium transition-colors"
            >
              <i className="fa-solid fa-play" />
              Execute Plan
            </button>
          )}
          {planText && (
            <button
              onClick={() => setShowPlan(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-violet-500-a15 hover:bg-violet-500-a30 text-violet-300 text-xs font-medium transition-colors"
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
            <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight, rehypeTwemoji]} components={mdComponents} urlTransform={(u: string) => u}>
              {planText}
            </Markdown>
          </div>

          {!alreadyExecuting && onExecute && (
            <div className="px-4 py-3 border-t border-border-subtle shrink-0">
              <button
                onClick={() => { onExecute(); setShowPlan(false) }}
                className="flex items-center gap-1.5 px-4 py-2 rounded-md bg-violet-500-a25 hover:bg-violet-500-a40 text-violet-200 text-sm font-medium transition-colors"
              >
                <i className="fa-solid fa-play" />
                Execute Plan
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function QuestionCard({ question, questions, answered, onAnswer }: {
  question: string
  questions?: StructuredQuestion[] | null
  answered: boolean
  onAnswer?: (answer: string) => void
}) {
  const [selections, setSelections] = useState<Map<number, Set<number>>>(new Map())
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(new Map())
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(new Map())
  const [freeText, setFreeText] = useState("")
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!answered && !questions?.length && inputRef.current) inputRef.current.focus()
  }, [answered, questions])

  const toggleOption = (qIdx: number, optIdx: number) => {
    if (answered) return
    const q = questions![qIdx]
    setSelections(prev => {
      const next = new Map(prev)
      const current = new Set(prev.get(qIdx) || [])
      if (q.multiSelect) {
        if (current.has(optIdx)) current.delete(optIdx)
        else current.add(optIdx)
      } else {
        current.clear()
        current.add(optIdx)
        setOtherActive(p => { const m = new Map(p); m.set(qIdx, false); return m })
        setOtherTexts(p => { const m = new Map(p); m.delete(qIdx); return m })
      }
      next.set(qIdx, current)
      return next
    })
  }

  const toggleOther = (qIdx: number) => {
    if (answered) return
    const q = questions![qIdx]
    setOtherActive(prev => {
      const next = new Map(prev)
      const isActive = !prev.get(qIdx)
      next.set(qIdx, isActive)
      if (!q.multiSelect && isActive) {
        setSelections(p => { const m = new Map(p); m.set(qIdx, new Set()); return m })
      }
      return next
    })
  }

  const canSubmit = (): boolean => {
    if (!questions?.length) return freeText.trim().length > 0
    return questions.every((_, i) => {
      const selected = selections.get(i) || new Set()
      const isOther = otherActive.get(i)
      const otherText = otherTexts.get(i)?.trim()
      return selected.size > 0 || (isOther && !!otherText)
    })
  }

  const buildAnswer = (): string => {
    if (!questions?.length) return freeText.trim()
    const parts: string[] = []
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i]
      const selected = selections.get(i) || new Set()
      const otherText = otherActive.get(i) ? otherTexts.get(i)?.trim() : undefined
      const labels = Array.from(selected).map(idx => q.options[idx]?.label).filter(Boolean)
      if (otherText) labels.push(otherText)
      const value = labels.join(", ")
      if (questions.length > 1) {
        parts.push(`${q.header || q.question}: ${value}`)
      } else {
        parts.push(value)
      }
    }
    return parts.join("\n")
  }

  const handleSubmit = () => {
    const answer = questions?.length ? buildAnswer() : freeText.trim()
    if (!answer || !onAnswer) return
    onAnswer(answer)
  }

  const handleFreeTextKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  if (!questions?.length) {
    return (
      <div className="my-3 rounded-lg border border-teal-500-a30 bg-teal-500-a8 p-3">
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
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              onKeyDown={handleFreeTextKeyDown}
              placeholder="Type your answer..."
              rows={1}
              className="flex-1 resize-none bg-overlay-6 rounded-md px-3 py-2 text-sm font-serif placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-teal-500-a50"
            />
            <button
              onClick={handleSubmit}
              disabled={!freeText.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-teal-500-a25 hover:bg-teal-500-a40 text-teal-200 text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <i className="fa-solid fa-paper-plane" />
              Answer
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div className="my-3 rounded-lg border border-teal-500-a30 bg-teal-500-a8 p-3">
      <div className="flex items-center gap-2 mb-3">
        <i className="fa-solid fa-circle-question text-sm text-teal-400" />
        <span className="text-sm font-medium text-teal-300">Question</span>
      </div>

      <div className="space-y-4">
        {questions.map((q, qIdx) => (
          <div key={qIdx}>
            {q.header && questions.length > 1 && (
              <span className="inline-block text-[10px] font-mono px-1.5 py-0.5 rounded bg-teal-500-a15 text-teal-300 mb-1.5">
                {q.header}
              </span>
            )}

            <p className="text-sm text-text-primary mb-2 font-serif">{q.question}</p>

            {q.multiSelect && (
              <p className="text-[11px] text-text-muted mb-2 italic">Select all that apply</p>
            )}

            <div className="space-y-1">
              {q.options.map((opt, optIdx) => {
                const isSelected = !!(selections.get(qIdx) || new Set()).has(optIdx)
                return (
                  <button
                    key={optIdx}
                    onClick={() => toggleOption(qIdx, optIdx)}
                    disabled={answered}
                    className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left transition-colors cursor-pointer ${
                      isSelected
                        ? "bg-teal-500-a20 border border-teal-500-a40"
                        : "bg-overlay-4 border border-transparent hover:bg-overlay-8"
                    } disabled:opacity-60 disabled:cursor-not-allowed`}
                  >
                    <span className={`mt-0.5 shrink-0 w-4 h-4 ${q.multiSelect ? "rounded-sm" : "rounded-full"} border flex items-center justify-center ${
                      isSelected ? "border-teal-400 bg-teal-500-a30" : "border-text-muted"
                    }`}>
                      {isSelected && (
                        q.multiSelect
                          ? <i className="fa-solid fa-check text-[9px] text-teal-300" />
                          : <span className="w-2 h-2 rounded-full bg-teal-400" />
                      )}
                    </span>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-text-primary">{opt.label}</span>
                      {opt.description && (
                        <span className="block text-xs text-text-muted mt-0.5">{opt.description}</span>
                      )}
                    </div>
                  </button>
                )
              })}

              <button
                onClick={() => toggleOther(qIdx)}
                disabled={answered}
                className={`w-full flex items-start gap-2.5 px-3 py-2 rounded-md text-left transition-colors cursor-pointer ${
                  otherActive.get(qIdx)
                    ? "bg-teal-500-a20 border border-teal-500-a40"
                    : "bg-overlay-4 border border-transparent hover:bg-overlay-8"
                } disabled:opacity-60 disabled:cursor-not-allowed`}
              >
                <span className={`mt-0.5 shrink-0 w-4 h-4 ${q.multiSelect ? "rounded-sm" : "rounded-full"} border flex items-center justify-center ${
                  otherActive.get(qIdx) ? "border-teal-400 bg-teal-500-a30" : "border-text-muted"
                }`}>
                  {otherActive.get(qIdx) && (
                    q.multiSelect
                      ? <i className="fa-solid fa-check text-[9px] text-teal-300" />
                      : <span className="w-2 h-2 rounded-full bg-teal-400" />
                  )}
                </span>
                <span className="text-sm text-text-muted italic">Other...</span>
              </button>

              {otherActive.get(qIdx) && !answered && (
                <div className="ml-[26px] mt-1">
                  <input
                    type="text"
                    value={otherTexts.get(qIdx) || ""}
                    onChange={(e) => setOtherTexts(prev => { const m = new Map(prev); m.set(qIdx, e.target.value); return m })}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit() } }}
                    placeholder="Type your answer..."
                    autoFocus
                    className="w-full bg-overlay-6 rounded-md px-3 py-1.5 text-sm font-serif placeholder:text-text-muted focus:outline-none focus:ring-1 focus:ring-teal-500-a50"
                  />
                </div>
              )}
            </div>

            {qIdx < questions.length - 1 && (
              <div className="border-t border-teal-500-a15 mt-3" />
            )}
          </div>
        ))}
      </div>

      <div className="mt-3">
        {answered ? (
          <span className="flex items-center gap-1.5 text-xs text-text-muted italic">
            <i className="fa-solid fa-check text-xs text-green-400" />
            Answered
          </span>
        ) : onAnswer ? (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md bg-teal-500-a25 hover:bg-teal-500-a40 text-teal-200 text-xs font-medium transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <i className="fa-solid fa-paper-plane" />
            Submit
          </button>
        ) : null}
      </div>
    </div>
  )
}

function NovaEventSquare({ event }: { event: NovaEvent }) {
  const [open, setOpen] = useState(false)
  const displaySource = event.source.replace(/^automation:/, "")

  return (
    <div className="py-1.5 px-0.5">
      <button
        onClick={() => setOpen(true)}
        className="w-2.5 h-2.5 rounded-[2px] transition-all duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer square-spawn"
        style={{ backgroundColor: COLOR.nova }}
        title={displaySource}
      />

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: COLOR.nova }} />
            <i className={`${novaEventIcon(event.type)} text-sm text-pink-400`} />
            <DialogTitle className="text-sm">{displaySource}</DialogTitle>
            <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-overlay-6 text-text-disabled">
              {event.type}
            </span>
          </DialogHeader>

          <div className="overflow-y-auto p-4 flex-1 min-h-0">
            <p className="text-sm text-text-primary font-serif whitespace-pre-wrap">{event.content}</p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const metadataLabels: Record<string, string> = {
  model: "Model",
  inputTokens: "Input tokens",
  outputTokens: "Output tokens",
  totalTokens: "Total tokens",
  cacheRead: "Cache read",
  cacheCreation: "Cache creation",
  duration: "Duration",
  stopReason: "Stop reason",
  provider: "Provider",
}

function formatMetaValue(key: string, value: unknown): string {
  if (value == null) return "—"
  if (typeof value === "number") {
    if (key === "duration") return value < 1000 ? `${value}ms` : `${(value / 1000).toFixed(1)}s`
    if (key.toLowerCase().includes("token") || key.toLowerCase().includes("cache")) return value.toLocaleString()
  }
  return String(value)
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: "short", day: "numeric", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    })
  } catch { return iso }
}

function MessageMetadata({ block }: { block: MessageBlock }) {
  const [open, setOpen] = useState(false)
  const meta = block.metadata
  const entries = meta ? Object.entries(meta).filter(([, v]) => v != null) : []
  const toolUseCount = block.parts.filter(p => p.type === "tool_use").length

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute top-1 right-1 opacity-20 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover/msg:opacity-40 hover:!opacity-100 transition-opacity duration-150 p-1 cursor-pointer z-10"
        title="Message info"
      >
        <i className="fa-solid fa-circle-info text-[10px] text-text-muted" />
      </button>

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-sm max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <i className="fa-solid fa-circle-info text-sm text-text-muted" />
            <DialogTitle className="text-sm">Message Info</DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto p-4 flex-1 min-h-0 space-y-2">
            <MetaRow label="Timestamp" value={formatTimestamp(block.timestamp)} />
            <MetaRow label="Message ID" value={block.id} mono />
            {toolUseCount > 0 && <MetaRow label="Tool calls" value={String(toolUseCount)} />}
            {entries.map(([key, value]) => (
              <MetaRow
                key={key}
                label={metadataLabels[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, s => s.toUpperCase())}
                value={formatMetaValue(key, value)}
                mono={key === "model" || key === "provider"}
              />
            ))}
            {entries.length === 0 && (
              <p className="text-xs text-text-disabled italic pt-1">No additional metadata available.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-4 text-xs">
      <span className="text-text-muted shrink-0">{label}</span>
      <span className={`text-text-secondary text-right break-all ${mono ? "font-mono text-[11px]" : ""}`}>{value}</span>
    </div>
  )
}

function TaskNotificationSquare({ notification }: { notification: TaskNotification }) {
  const [open, setOpen] = useState(false)
  const failed = notification.status !== "completed"

  return (
    <div className="py-1.5 px-0.5">
      <button
        onClick={() => setOpen(true)}
        className="w-2.5 h-2.5 rounded-[2px] transition-all duration-100 hover:brightness-125 hover:scale-[1.5] cursor-pointer square-spawn"
        style={{ backgroundColor: COLOR.fallback }}
        title={notification.summary}
      />

      <Dialog open={open} onOpenChange={v => { if (!v) setOpen(false) }}>
        <DialogContent className="max-w-md sm:max-w-lg max-h-[70vh] flex flex-col p-0 gap-0">
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <div className="w-3 h-3 rounded-[2px]" style={{ backgroundColor: COLOR.fallback }} />
            <DialogTitle className="text-sm">Background Task</DialogTitle>
            <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${failed ? "bg-accent-red-a10 text-accent-red" : "bg-overlay-6 text-text-disabled"}`}>
              {notification.status}
            </span>
          </DialogHeader>

          <div className="overflow-y-auto p-4 flex-1 min-h-0 space-y-3">
            <p className="text-sm text-text-primary">{notification.summary}</p>
            {notification.taskId && (
              <div className="flex justify-between text-xs">
                <span className="text-text-muted">Task ID</span>
                <span className="font-mono text-text-disabled">{notification.taskId}</span>
              </div>
            )}
            {notification.outputFile && (
              <div className="text-xs">
                <span className="text-text-muted">Output</span>
                <pre className="mt-1 font-mono text-text-disabled bg-overlay-4 rounded px-2 py-1.5 break-all whitespace-pre-wrap">{notification.outputFile}</pre>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
