import { useMemo, useState } from "react"
import { formatContextSize, parseMessageContextBlock, type MessageContextSection } from "../lib/message-context"

/**
 * The context a host stored with a user message, in Message Info: folded at first, then its
 * sections (each foldable; the outfit and the prior message start folded), or the exact raw text.
 * Each part scrolls on its own, so a 10 KB context stays usable in a phone-width dialog.
 */
export function StoredMessageContext({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState(false)
  const view = useMemo(() => parseMessageContextBlock(text), [text])
  const showRaw = raw || !view || view.sections.length === 0

  return (
    <div data-slot="message-context" className="border-t border-border-subtle my-1 pt-2">
      <button
        type="button"
        data-slot="message-context-toggle"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 text-[10px] text-text-muted uppercase tracking-wider cursor-pointer hover:text-text-secondary"
      >
        <i className={`ph-bold ${open ? "ph-caret-down" : "ph-caret-right"} text-[8px]`} />
        <span>Injected context</span>
        <span className="ml-auto normal-case tracking-normal text-text-disabled">{formatContextSize(text)}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-1.5">
          {showRaw
            ? <ContextText data-slot="message-context-raw" text={text} tall />
            : view!.sections.map((section, index) => <ContextSectionView key={`${section.kind}-${index}`} section={section} />)}
          {view && view.sections.length > 0 && (
            <button
              type="button"
              data-slot="message-context-raw-toggle"
              onClick={() => setRaw(!raw)}
              className="text-[10px] text-accent hover:text-accent-hover cursor-pointer"
            >
              {raw ? "Show sections" : "Show exact text"}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function ContextSectionView({ section }: { section: MessageContextSection }) {
  const [open, setOpen] = useState(!section.collapsed)
  const items = section.lines.filter(line => line.startsWith("- ")).length

  return (
    <section data-slot="message-context-section" data-kind={section.kind} className="rounded-md bg-overlay-4">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-text-secondary cursor-pointer hover:text-text-primary text-left"
      >
        <i className={`ph-bold ${open ? "ph-caret-down" : "ph-caret-right"} text-[8px] text-text-muted shrink-0`} />
        <span className="min-w-0 truncate">{section.title}</span>
        {items > 0 && <span className="ml-auto shrink-0 text-[10px] text-text-disabled">{items}</span>}
      </button>
      {open && <ContextText text={section.lines.join("\n")} />}
    </section>
  )
}

function ContextText({ text, tall, ...rest }: { text: string; tall?: boolean; "data-slot"?: string }) {
  return (
    <pre
      {...rest}
      className={`text-[11px] font-mono whitespace-pre-wrap break-words [overflow-wrap:anywhere] text-text-secondary px-2.5 pb-2 leading-relaxed overflow-y-auto ${tall ? "max-h-[50svh] bg-overlay-4 rounded-md pt-2" : "max-h-64"}`}
    >
      {text}
    </pre>
  )
}
