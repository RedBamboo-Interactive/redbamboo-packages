import type { QueuedMessage } from "./message-queue.ts"
import { loadQueue, saveQueue, type StorageLike } from "./message-queue-storage.ts"

const migratingSessions = new Set<string>()

/**
 * Keep an input recoverable until the server acknowledges durable admission.
 * The write intentionally happens before the submit promise is created.
 */
export async function admitWithOutbox<T>(
  storage: StorageLike | null,
  sessionId: string,
  entry: QueuedMessage,
  submit: () => T | Promise<T>,
  now = Date.now(),
): Promise<T> {
  if (storage) {
    saveQueue(storage, sessionId, [
      ...loadQueue(storage, sessionId).filter(item => item.id !== entry.id),
      entry,
    ], now)
  }
  const result = await submit()
  if (storage) {
    saveQueue(storage, sessionId, loadQueue(storage, sessionId).filter(item => item.id !== entry.id), Date.now())
  }
  return result
}

export const HELD_BEHIND_FAILED = "Not sent yet: an earlier message was not delivered. Retry or edit it first."

/**
 * Migrate a legacy browser queue once per session, always releasing the migration lease.
 *
 * A record the server already refused (it carries a definitive deliveryError) is never re-sent
 * here: only the person decides to retry it. The migration stops at the first record it cannot
 * deliver, so FIFO order holds, and hands every record left behind to `stranded` so the host can
 * show it as failed rather than keep it invisibly in storage.
 */
export async function migrateLegacyOutbox(
  storage: StorageLike,
  sessionId: string,
  submit: (entry: QueuedMessage) => void | Promise<unknown>,
  refresh: () => void | Promise<void>,
  stranded?: (entries: QueuedMessage[]) => void,
): Promise<void> {
  if (migratingSessions.has(sessionId)) return
  const legacy = loadQueue(storage, sessionId)
  if (legacy.length === 0) return
  migratingSessions.add(sessionId)
  try {
    let remaining = legacy
    let failure: QueuedMessage | undefined
    for (const item of legacy) {
      if (item.deliveryError && !item.admissionUncertain) {
        failure = item
        break
      }
      try {
        await submit(item)
        remaining = remaining.filter(candidate => candidate.id !== item.id)
        saveQueue(storage, sessionId, remaining, Date.now())
      } catch (error) {
        // The server did not acknowledge this draft. Preserve it and every
        // successor so a one-release migration cannot invert the old FIFO.
        const message = error instanceof Error ? error.message : "Message admission failed"
        const definitive = typeof (error as { status?: unknown } | null)?.status === "number"
        failure = {
          ...item,
          admissionUncertain: !definitive,
          deliveryError: definitive ? message : `Admission unconfirmed: ${message}`,
        }
        break
      }
    }
    if (failure && stranded) {
      stranded(remaining.map(item => ({
        ...(item.id === failure!.id ? failure! : item),
        appearance: "queue" as const,
        optimistic: true,
        deliveryError: item.id === failure!.id ? failure!.deliveryError : item.deliveryError ?? HELD_BEHIND_FAILED,
      })))
    }
    await refresh()
  } finally {
    migratingSessions.delete(sessionId)
  }
}

export function resetLegacyOutboxMigrations(): void {
  migratingSessions.clear()
}
