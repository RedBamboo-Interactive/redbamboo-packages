import { useState } from "react"
import { Badge, Button, Dialog, DialogContent, DialogHeader, DialogTitle, Input, buttonVariants, cn } from "@redbamboo/ui"
import type { QuestionAnswerPayload, QuestionOutcome, StructuredQuestion } from "../types"

export type QuestionCardStatus = "pending" | QuestionOutcome

const OUTCOME_COPY: Record<QuestionOutcome, { icon: string; tone: string; label: string }> = {
  answered: { icon: "ph-check", tone: "text-green-400", label: "Answered" },
  declined: { icon: "ph-x", tone: "text-text-muted", label: "Dismissed without answering" },
  timeout: { icon: "ph-clock-countdown", tone: "text-amber-400", label: "Timed out — the model carried on without an answer" },
  cancelled: { icon: "ph-prohibit", tone: "text-amber-400", label: "Cancelled before it could be answered" },
  session_ended: { icon: "ph-plugs", tone: "text-amber-400", label: "Session ended before it could be answered" },
  unresolved: { icon: "ph-warning", tone: "text-amber-400", label: "No answer reached the model" },
}

function QuestionResolution({ status, className }: { status: QuestionOutcome; className?: string }) {
  const { icon, tone, label } = OUTCOME_COPY[status]
  return (
    <span data-slot="question-resolution" className={cn("flex min-w-0 items-center gap-1.5 text-xs text-text-muted", className)}>
      <i className={`ph-bold ${icon} shrink-0 text-xs ${tone}`} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  )
}

/**
 * A question from the model, embedded in the transcript as a compact card.
 *
 * The card only summarises; answering happens in a dialog it opens. Answer
 * state lives here rather than in the dialog so closing and reopening keeps
 * what was already picked. A settled question still opens, read-only, so the
 * options it offered stay inspectable.
 */
export function QuestionCard({ question, questions, status, onAnswer }: {
  question: string
  questions?: StructuredQuestion[] | null
  status: QuestionCardStatus
  onAnswer?: (answer: string, payload?: QuestionAnswerPayload) => void
}) {
  const answered = status !== "pending"
  const answerable = !answered && !!onAnswer
  const structured = questions?.length ? questions : null
  const [open, setOpen] = useState(false)
  const [selections, setSelections] = useState<Map<number, Set<number>>>(new Map())
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(new Map())
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(new Map())
  const [freeText, setFreeText] = useState("")

  const toggleOption = (qIdx: number, optIdx: number) => {
    if (!answerable) return
    const q = structured![qIdx]
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
    if (!answerable) return
    const q = structured![qIdx]
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

  const isQuestionAnswered = (qIdx: number): boolean => {
    const selected = selections.get(qIdx) || new Set()
    const otherText = otherTexts.get(qIdx)?.trim()
    return selected.size > 0 || (!!otherActive.get(qIdx) && !!otherText)
  }

  const canSubmit = (): boolean => {
    if (!structured) return freeText.trim().length > 0
    return structured.every((_, i) => isQuestionAnswered(i))
  }

  /**
   * One value per question, in question order — the shape the backend zips
   * against its own copy of the questions. Multi-select is a single
   * comma-separated string, and "Other" text is comma-joined into that same
   * value rather than sent as freeform `response`, which would outrank (and so
   * discard) the selections.
   */
  const buildAnswers = (): string[] =>
    (structured ?? []).map((q, i) => {
      const selected = selections.get(i) || new Set()
      const otherText = otherActive.get(i) ? otherTexts.get(i)?.trim() : undefined
      const labels = Array.from(selected).map(idx => q.options[idx]?.label).filter(Boolean)
      if (otherText) labels.push(otherText)
      return labels.join(", ")
    })

  /** The same selections as one readable line, for echoing/speaking. */
  const summarize = (answers: string[]): string =>
    answers.length > 1
      ? answers.map((value, i) => `${structured![i].header || structured![i].question}: ${value}`).join("\n")
      : answers[0] ?? ""

  const handleSubmit = () => {
    if (!onAnswer || !answerable) return
    if (!structured) {
      const text = freeText.trim()
      if (!text) return
      onAnswer(text, { response: text })
      setOpen(false)
      return
    }
    const answers = buildAnswers()
    if (answers.some(a => !a)) return
    onAnswer(summarize(answers), { answers })
    setOpen(false)
  }

  const count = structured?.length ?? 1
  const answeredCount = structured ? structured.filter((_, i) => isQuestionAnswered(i)).length : 0
  const kicker = count > 1 ? `${count} questions` : "Question"

  return (
    <>
      <button
        type="button"
        data-slot="question-card"
        data-status={status}
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="group/question my-3 flex w-full max-w-xl items-center gap-3 rounded-md border border-overlay-10 bg-overlay-4 px-3 py-2.5 text-left outline-none transition-colors hover:border-overlay-20 hover:bg-overlay-6 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background cursor-pointer"
      >
        <span
          aria-hidden="true"
          className={cn(
            "flex size-9 shrink-0 items-center justify-center rounded-md bg-overlay-6",
            answered ? "text-text-muted" : "text-primary",
          )}
        >
          <i className="ph-bold ph-chat-circle-dots text-lg" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-[11px] text-text-muted">
            <span className="shrink-0 font-medium">{kicker}</span>
            {answered ? (
              <>
                <span aria-hidden="true">·</span>
                <QuestionResolution status={status as QuestionOutcome} className="text-[11px]" />
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">
                  {structured && answeredCount > 0 ? `${answeredCount} of ${count} picked` : "Waiting for your answer"}
                </span>
              </>
            )}
          </span>
          <span className="mt-0.5 line-clamp-2 font-serif text-sm leading-snug text-text-primary">{question}</span>
        </span>
        {answerable ? (
          <span className={cn(buttonVariants({ size: "sm" }), "shrink-0")}>
            Answer
            <i className="ph-bold ph-arrow-right text-xs" aria-hidden="true" />
          </span>
        ) : (
          <i className="ph-bold ph-caret-right shrink-0 text-sm text-text-muted transition-colors group-hover/question:text-text-primary" aria-hidden="true" />
        )}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          data-question-dialog=""
          className="max-w-md sm:max-w-xl max-h-[80vh] flex flex-col p-0 gap-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && canSubmit()) {
              e.preventDefault()
              handleSubmit()
            }
          }}
        >
          <DialogHeader className="flex-row items-center gap-2.5 px-4 py-3 border-b border-border-subtle shrink-0">
            <i className={cn("ph-bold ph-chat-circle-dots text-sm", answered ? "text-text-muted" : "text-primary")} aria-hidden="true" />
            <DialogTitle className="text-sm">{kicker}</DialogTitle>
          </DialogHeader>

          <div className="overflow-y-auto px-5 py-4 flex-1 min-h-0 space-y-6">
            {structured ? structured.map((q, qIdx) => (
              <section key={qIdx} data-slot="question-item" aria-label={q.header || q.question}>
                {q.header && (
                  <Badge variant="secondary" className="mb-2">{q.header}</Badge>
                )}
                <p className="font-serif text-[15px] leading-relaxed text-text-primary">{q.question}</p>
                <p className="mt-0.5 mb-3 text-[11px] text-text-muted">
                  {q.multiSelect ? "Select all that apply" : "Pick one"}
                </p>

                <div role={q.multiSelect ? "group" : "radiogroup"} aria-label={q.header || q.question} className="space-y-1.5">
                  {q.options.map((opt, optIdx) => (
                    <OptionRow
                      key={optIdx}
                      multi={!!q.multiSelect}
                      selected={!!selections.get(qIdx)?.has(optIdx)}
                      disabled={!answerable}
                      onToggle={() => toggleOption(qIdx, optIdx)}
                      label={opt.label}
                      description={opt.description}
                    />
                  ))}
                  <OptionRow
                    multi={!!q.multiSelect}
                    selected={!!otherActive.get(qIdx)}
                    disabled={!answerable}
                    onToggle={() => toggleOther(qIdx)}
                    label="Other"
                    description="Write your own answer"
                  />
                  {otherActive.get(qIdx) && answerable && (
                    <div className="pl-9 pt-0.5 pb-1">
                      <Input
                        value={otherTexts.get(qIdx) || ""}
                        onChange={(e) => setOtherTexts(prev => { const m = new Map(prev); m.set(qIdx, e.target.value); return m })}
                        onKeyDown={(e) => { if (e.key === "Enter" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); handleSubmit() } }}
                        placeholder="Type your answer…"
                        autoFocus
                        aria-label={`Other answer for ${q.header || q.question}`}
                        className="font-serif"
                      />
                    </div>
                  )}
                </div>
              </section>
            )) : (
              <section data-slot="question-item">
                <p className="mb-3 font-serif text-[15px] leading-relaxed text-text-primary whitespace-pre-wrap">{question}</p>
                {answerable && (
                  <textarea
                    value={freeText}
                    onChange={(e) => setFreeText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
                        e.preventDefault()
                        handleSubmit()
                      }
                    }}
                    placeholder="Type your answer…"
                    rows={3}
                    autoFocus
                    aria-label="Your answer"
                    className="w-full min-w-0 resize-none rounded-lg border border-input bg-transparent px-2.5 py-2 font-serif text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring-a50 dark:bg-input-a30"
                  />
                )}
              </section>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border-subtle shrink-0">
            {answered ? (
              <QuestionResolution status={status as QuestionOutcome} />
            ) : answerable ? (
              <span className="text-[11px] text-text-muted">
                {structured && count > 1 ? `${answeredCount} of ${count} answered` : "Ctrl+Enter to send"}
              </span>
            ) : (
              <span className="text-[11px] text-text-muted">Waiting for an answer</span>
            )}
            {answerable && (
              <Button onClick={handleSubmit} disabled={!canSubmit()}>
                <i className="ph-bold ph-paper-plane-right" aria-hidden="true" />
                {count > 1 ? "Send answers" : "Send answer"}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function OptionRow({ multi, selected, disabled, onToggle, label, description }: {
  multi: boolean
  selected: boolean
  disabled: boolean
  onToggle: () => void
  label: string
  description?: string
}) {
  return (
    <button
      type="button"
      role={multi ? "checkbox" : "radio"}
      aria-checked={selected}
      disabled={disabled}
      onClick={onToggle}
      data-selected={selected || undefined}
      className={cn(
        "flex w-full items-start gap-3 rounded-md border px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring-a50",
        selected
          ? "border-primary bg-overlay-6"
          : "border-overlay-10 bg-overlay-2 hover:border-overlay-20 hover:bg-overlay-4",
        disabled ? "cursor-default" : "cursor-pointer",
        disabled && !selected && "opacity-60",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mt-0.5 flex size-4 shrink-0 items-center justify-center border transition-colors",
          multi ? "rounded-[4px]" : "rounded-full",
          selected ? "border-primary bg-primary text-primary-foreground" : "border-overlay-30",
        )}
      >
        {selected && (multi
          ? <i className="ph-bold ph-check text-[10px]" />
          : <span className="size-1.5 rounded-full bg-primary-foreground" />)}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-text-primary">{label}</span>
        {description && <span className="mt-0.5 block text-xs leading-snug text-text-muted">{description}</span>}
      </span>
    </button>
  )
}
