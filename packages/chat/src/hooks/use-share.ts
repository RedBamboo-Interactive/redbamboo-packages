import { useCallback, useState } from "react"
import { shareErrorMessage, type ShareSource } from "../lib/share-sources"

export interface ShareState {
  shareUrl: string | null
  loading: boolean
  error: string | null
  createShare: () => Promise<void>
  revokeShare: () => Promise<void>
  loadShare: () => Promise<void>
  reset: () => void
}

/**
 * A conversation's share link, whatever it comes from: pass a source from
 * {@link discussionShareSource} or {@link sessionShareSource}, or null while there is nothing to share.
 * Memoise the source on its id, so the callbacks stay stable.
 */
export function useShare(source: ShareSource | null): ShareState {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shareUrl, setShareUrl] = useState<string | null>(null)

  const createShare = useCallback(async () => {
    if (!source) return
    setLoading(true)
    setError(null)
    try {
      const result = await source.create()
      setShareUrl(result.url)
    } catch (e) {
      setError(shareErrorMessage(e, "Failed to create share link"))
    } finally {
      setLoading(false)
    }
  }, [source])

  const revokeShare = useCallback(async () => {
    if (!source) return
    setError(null)
    try {
      const info = await source.info()
      if (info.active && info.shareId) await source.revoke(info.shareId)
      setShareUrl(null)
    } catch (e) {
      setError(shareErrorMessage(e, "Failed to revoke share"))
    }
  }, [source])

  const loadShare = useCallback(async () => {
    if (!source) return
    try {
      const info = await source.info()
      setShareUrl(info.active ? (info.url ?? null) : null)
    } catch {
      setShareUrl(null)
    }
  }, [source])

  const reset = useCallback(() => {
    setShareUrl(null)
    setError(null)
    setLoading(false)
  }, [])

  return { shareUrl, loading, error, createShare, revokeShare, loadShare, reset }
}
