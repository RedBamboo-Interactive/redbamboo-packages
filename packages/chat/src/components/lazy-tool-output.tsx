import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { TranscriptPayloadLoader, TranscriptPayloadRef } from "../types"
import { ToolOutputView } from "./tool-output"

const CHUNK_BYTES = 20 * 1024

interface Props {
  payloadRef: TranscriptPayloadRef
  load: TranscriptPayloadLoader
  downloadUrl?: string
  isError?: boolean
  toolName?: string
  toolInput?: string
  resolveFileLink?: (filePath: string, opts?: { line?: number }) => (() => void) | undefined
  resolveImageSrc?: (src: string) => string | undefined
  onNavigate?: () => void
}

export function LazyToolOutput({
  payloadRef,
  load,
  downloadUrl,
  isError,
  toolName,
  toolInput,
  resolveFileLink,
  resolveImageSrc,
  onNavigate,
}: Props) {
  const [chunks, setChunks] = useState<Uint8Array[]>([])
  const [loaded, setLoaded] = useState(0)
  const [total, setTotal] = useState(payloadRef.length)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const loadedRef = useRef(0)

  const requestChunk = useCallback(async (start: number) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setLoading(true)
    setError(null)
    try {
      const chunk = await load(payloadRef, {
        start,
        end: Math.min(start + CHUNK_BYTES, payloadRef.length),
      }, controller.signal)
      if (controller.signal.aborted) return
      setChunks(prev => start === 0 ? [chunk.bytes] : [...prev, chunk.bytes])
      loadedRef.current = chunk.end
      setLoaded(chunk.end)
      setTotal(chunk.total)
    } catch (err) {
      if (!controller.signal.aborted)
        setError(err instanceof Error ? err.message : "Could not load tool output")
    } finally {
      if (!controller.signal.aborted) setLoading(false)
    }
  }, [load, payloadRef])

  useEffect(() => {
    loadedRef.current = 0
    setChunks([])
    setLoaded(0)
    setTotal(payloadRef.length)
    if (payloadRef.available) void requestChunk(0)
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
      loadedRef.current = 0
    }
  }, [payloadRef, requestChunk])

  const content = useMemo(() => {
    const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
    const combined = new Uint8Array(length)
    let offset = 0
    for (const chunk of chunks) {
      combined.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder(payloadRef.encoding || "utf-8").decode(combined)
  }, [chunks, payloadRef.encoding])

  if (!payloadRef.available)
    return <p className="text-xs text-text-disabled italic">Output expired</p>

  return (
    <div className="space-y-2">
      {content ? (
        <ToolOutputView
          content={content}
          isError={isError}
          toolName={toolName}
          toolInput={toolInput}
          resolveFileLink={resolveFileLink}
          resolveImageSrc={resolveImageSrc}
          onNavigate={onNavigate}
        />
      ) : loading ? (
        <p className="text-xs text-text-disabled italic">Loading output...</p>
      ) : !error ? (
        <p className="text-xs text-text-disabled italic">No output</p>
      ) : null}

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-300-a80">
          <span>{error}</span>
          <button className="text-text-muted hover:text-contrast underline" onClick={() => void requestChunk(loadedRef.current)}>
            Retry
          </button>
        </div>
      )}

      <div className="flex items-center gap-3 text-[11px] text-text-muted">
        {loaded < total && !error && (
          <button
            className="rounded bg-overlay-6 px-2 py-1 hover:bg-overlay-10 hover:text-contrast disabled:opacity-50"
            disabled={loading}
            onClick={() => void requestChunk(loadedRef.current)}
          >
            {loading ? "Loading..." : "Show more"}
          </button>
        )}
        {downloadUrl && (
          <a className="hover:text-contrast underline" href={downloadUrl} download>
            Download full output
          </a>
        )}
        {total > 0 && <span className="ml-auto font-mono">{loaded.toLocaleString()} / {total.toLocaleString()} bytes</span>}
      </div>
    </div>
  )
}
