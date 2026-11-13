import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FocusMessageRequest, FocusMessageResult } from "../types"
import { GoToMessageController } from "../lib/go-to-message"

export interface UseGoToMessageOptions {
  /** The open conversation; changing it cancels a search. */
  conversationId: string | null
  /** Whether the transcript still has pages before the oldest loaded one. */
  hasEarlier: boolean
  /** True while an earlier page is being read, whoever asked for it. */
  isLoadingEarlier: boolean
  /** Reads one earlier page through the same pager that scrolling up uses. */
  loadEarlier: () => Promise<void> | void
  /** The message could not be reached after the bounded search. */
  onMissing: () => void
}

export interface GoToMessage {
  /** Centre a message, paging earlier history in while it is not loaded. */
  go: (uid: string) => void
  /** Pass to ChatPanel's `focusMessageRequest`. */
  focusRequest: FocusMessageRequest | null
  /** Pass to ChatPanel's `onFocusMessageResult`. */
  onFocusMessageResult: (result: FocusMessageResult) => void
  /** True while the search reads earlier pages, for a visible "Loading earlier messages" state. */
  seeking: boolean
}

/**
 * "Go to message" for a chat host: asks ChatPanel to centre a message and, while it answers "not
 * loaded", reads one earlier page and asks again (bounded by {@link GoToMessageController}).
 */
export function useGoToMessage(options: UseGoToMessageOptions): GoToMessage {
  const [focusRequest, setFocusRequest] = useState<FocusMessageRequest | null>(null)
  const [seeking, setSeeking] = useState(false)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const controller = useMemo(() => new GoToMessageController({
    hasEarlier: () => optionsRef.current.hasEarlier,
    isLoadingEarlier: () => optionsRef.current.isLoadingEarlier,
    loadEarlier: () => optionsRef.current.loadEarlier(),
    focus: (request) => setFocusRequest(request),
    missing: () => optionsRef.current.onMissing(),
    seeking: (active) => setSeeking(active),
  }), [])
  useEffect(() => {
    controller.cancel()
    setFocusRequest(null)
  }, [options.conversationId, controller])
  useEffect(() => () => controller.cancel(), [controller])
  const go = useCallback((uid: string) => controller.go(uid), [controller])
  const onFocusMessageResult = useCallback((result: FocusMessageResult) => controller.result(result), [controller])
  return { go, focusRequest, onFocusMessageResult, seeking }
}
