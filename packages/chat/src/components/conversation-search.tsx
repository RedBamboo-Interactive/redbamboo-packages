import { useEffect, useRef, useState } from "react"
import { Input, ModalBase, ModalHeader } from "@redbamboo/ui"

export interface ConversationSearchResult {
  /** The conversation to open. */
  id: string
  title: string
  /** A short note beside the title, e.g. "3 matches" or "archived". */
  meta?: string
  snippet?: string
  /** Who said the snippet, shown before it. */
  snippetLabel?: string
  /** The message the snippet comes from, when the source knows it. */
  messageUid?: string | null
}

/** Where the dialog's results come from. Rejections show as no matches. */
export interface ConversationSearchSource {
  search(query: string, signal: AbortSignal): Promise<ConversationSearchResult[]>
}

export interface ConversationSearchDialogProps {
  source: ConversationSearchSource
  onSelect: (result: ConversationSearchResult) => void
  onClose: () => void
  title?: string
  placeholder?: string
  /** The modal's data-modal value, a stable hook for tests. */
  dataModal?: string
  ariaLabel?: string
  /** Queries shorter than this do not search (the servers answer 400 under two characters). */
  minQueryLength?: number
}

const DEBOUNCE_MS = 300

/** Full-text search over a host's conversations; a result opens its conversation. */
export function ConversationSearchDialog({
  source,
  onSelect,
  onClose,
  title = "Search Conversations",
  placeholder = "Search all conversation content…",
  dataModal = "conversation-search",
  ariaLabel = "Search conversations",
  minQueryLength = 2,
}: ConversationSearchDialogProps) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<ConversationSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const sourceRef = useRef(source)
  sourceRef.current = source

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const q = query.trim()
    if (q.length < minQueryLength) {
      setResults([])
      setSearching(false)
      return
    }
    setSearching(true)
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const found = await sourceRef.current.search(q, controller.signal)
        if (!controller.signal.aborted) setResults(found)
      } catch {
        if (!controller.signal.aborted) setResults([])
      } finally {
        if (!controller.signal.aborted) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [query, minQueryLength])

  return (
    <ModalBase dataModal={dataModal} ariaLabel={ariaLabel} onClose={onClose} size="lg">
      <ModalHeader
        icon={<i className="ph-bold ph-magnifying-glass text-primary" />}
        title={<span className="text-sm font-medium">{title}</span>}
        onClose={onClose}
      />
      <div data-slot="conversation-search" className="px-6 pb-5 space-y-3">
        <Input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
        />
        <div className="max-h-80 overflow-y-auto space-y-0.5">
          {results.map((result) => (
            <button
              key={`${result.id}\n${result.messageUid ?? ""}`}
              type="button"
              data-slot="conversation-search-result"
              data-conversation-id={result.id}
              onClick={() => onSelect(result)}
              className="w-full text-left px-3 py-2 rounded hover:bg-overlay-10 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-sm text-contrast truncate">{result.title || "Untitled"}</span>
                {result.meta && <span className="text-[10px] text-text-muted shrink-0">{result.meta}</span>}
              </div>
              {result.snippet && (
                <div className="text-xs text-text-muted truncate mt-0.5">
                  {result.snippetLabel && <span className="opacity-60 mr-1">{result.snippetLabel}:</span>}
                  {result.snippet}
                </div>
              )}
            </button>
          ))}
          {query.trim().length >= minQueryLength && !searching && results.length === 0 && (
            <div className="text-xs text-text-muted text-center py-6">No matches</div>
          )}
          {searching && (
            <div className="text-xs text-text-muted text-center py-6">
              <i className="ph-bold ph-spinner animate-spin mr-1.5" />
              Searching…
            </div>
          )}
        </div>
      </div>
    </ModalBase>
  )
}
