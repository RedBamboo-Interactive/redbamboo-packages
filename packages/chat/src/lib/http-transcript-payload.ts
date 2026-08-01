import type { TranscriptPayloadChunk, TranscriptPayloadRange, TranscriptPayloadRef } from "../types"

/** Shared HTTP Range implementation used by every Red Suite chat consumer. */
export async function fetchTranscriptPayload(
  url: string,
  ref: TranscriptPayloadRef,
  range: TranscriptPayloadRange,
  signal: AbortSignal,
): Promise<TranscriptPayloadChunk> {
  const response = await fetch(url, {
    credentials: "include",
    signal,
    headers: { Range: `bytes=${range.start}-${Math.max(range.start, range.end - 1)}` },
  })
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null
    throw new Error(body?.message || body?.error || `Could not load output (${response.status})`)
  }

  const bytes = new Uint8Array(await response.arrayBuffer())
  const contentRange = response.headers.get("content-range")
  const match = contentRange?.match(/^bytes\s+(\d+)-(\d+)\/(\d+)$/i)
  const start = match ? Number(match[1]) : range.start
  const total = match ? Number(match[3]) : ref.length
  return { bytes, start, end: start + bytes.byteLength, total }
}
