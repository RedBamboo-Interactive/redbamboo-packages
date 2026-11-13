import { useCallback, useEffect, useRef, useState } from "react"
import { useToast } from "@redbamboo/ui"

/**
 * "Update title": regenerates a conversation's title from its transcript, at most one at a time,
 * with the pending state the menu item shows and the same success and error toasts in every host.
 * `update` resolves to the new title (empty when the server kept none). A new `conversationId`
 * clears the pending state, so another conversation's item is never left disabled.
 */
export function useTitleUpdate(
  update: (id: string) => Promise<{ title?: string | null }>,
  emptyTitle = "New conversation",
  conversationId?: string | null,
) {
  const { toast } = useToast()
  const [pending, setPending] = useState(false)
  const pendingRef = useRef(false)
  useEffect(() => {
    pendingRef.current = false
    setPending(false)
  }, [conversationId])
  const run = useCallback(async (id: string) => {
    if (pendingRef.current) return
    pendingRef.current = true
    setPending(true)
    try {
      const updated = await update(id)
      toast({ variant: "success", title: "Title updated", description: updated.title || emptyTitle })
    } catch (error) {
      toast({
        variant: "error",
        title: "Could not update title",
        description: error instanceof Error ? error.message : "Unknown error",
      })
    } finally {
      pendingRef.current = false
      setPending(false)
    }
  }, [emptyTitle, toast, update])
  return { pending, run }
}
