import type { QueuedMessage } from "./message-queue"

/** Minimal `Storage` shape (matches `window.localStorage`) so this stays testable without a DOM. */
export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
  key(index: number): string | null
  readonly length: number
}

const KEY_PREFIX = "rb-chat-queue:"
export const MAX_QUEUE_AGE_MS = 1000 * 60 * 60 * 24 * 14 // 14 days
export const MAX_STORED_SESSIONS = 50

interface StoredQueue {
  items: QueuedMessage[]
  savedAt: number
}

export function loadQueue(storage: StorageLike, sessionId: string): QueuedMessage[] {
  try {
    const raw = storage.getItem(KEY_PREFIX + sessionId)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredQueue
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch {
    return []
  }
}

export function saveQueue(storage: StorageLike, sessionId: string, queue: QueuedMessage[], now: number): void {
  const key = KEY_PREFIX + sessionId
  try {
    if (queue.length === 0) storage.removeItem(key)
    else storage.setItem(key, JSON.stringify({ items: queue, savedAt: now }))
  } catch { /* storage unavailable (SSR, disabled cookies, quota) — queue still lives in memory */ }
}

/** Drops queues older than MAX_QUEUE_AGE_MS and, beyond that, any but the MAX_STORED_SESSIONS most recent. */
export function pruneStaleQueues(storage: StorageLike, now: number): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i)
      if (k?.startsWith(KEY_PREFIX)) keys.push(k)
    }

    const byRecency = keys
      .map(key => {
        let savedAt = 0
        try { savedAt = (JSON.parse(storage.getItem(key) || "{}") as StoredQueue).savedAt ?? 0 } catch { /* corrupt entry sorts as oldest */ }
        return { key, savedAt }
      })
      .sort((a, b) => b.savedAt - a.savedAt)

    byRecency.forEach((entry, i) => {
      const stale = now - entry.savedAt > MAX_QUEUE_AGE_MS
      const overflow = i >= MAX_STORED_SESSIONS
      if (stale || overflow) storage.removeItem(entry.key)
    })
  } catch { /* storage unavailable — nothing to prune */ }
}
