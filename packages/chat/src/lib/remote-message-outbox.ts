import type { QueuedMessage } from "./message-queue.ts"
import { loadQueue, saveQueue, type StorageLike } from "./message-queue-storage.ts"

const migratingSessions = new Set<string>()

/**
 * Keep an input recoverable until the server acknowledges durable admission.
 * The write intentionally happens before the submit promise is created.
 */
export async function admitWithOutbox(
  storage: StorageLike | null,
  sessionId: string,
  entry: QueuedMessage,
  submit: () => void | Promise<unknown>,
  now = Date.now(),
): Promise<void> {
  if (storage) {
    saveQueue(storage, sessionId, [
      ...loadQueue(storage, sessionId).filter(item => item.id !== entry.id),
      entry,
    ], now)
  }
  await submit()
  if (storage) {
    saveQueue(storage, sessionId, loadQueue(storage, sessionId).filter(item => item.id !== entry.id), Date.now())
  }
}

/** Migrate a legacy browser queue once per session, always releasing the migration lease. */
export async function migrateLegacyOutbox(
  storage: StorageLike,
  sessionId: string,
  submit: (entry: QueuedMessage) => void | Promise<unknown>,
  refresh: () => void | Promise<void>,
): Promise<void> {
  if (migratingSessions.has(sessionId)) return
  const legacy = loadQueue(storage, sessionId)
  if (legacy.length === 0) return
  migratingSessions.add(sessionId)
  try {
    let remaining = legacy
    for (const item of legacy) {
      try {
        await submit(item)
        remaining = remaining.filter(candidate => candidate.id !== item.id)
        saveQueue(storage, sessionId, remaining, Date.now())
      } catch {
        // The server did not acknowledge this draft. Preserve it and every
        // successor so a one-release migration cannot invert the old FIFO.
        break
      }
    }
    await refresh()
  } finally {
    migratingSessions.delete(sessionId)
  }
}

export function resetLegacyOutboxMigrations(): void {
  migratingSessions.clear()
}
