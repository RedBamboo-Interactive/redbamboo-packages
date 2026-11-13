import type { ChatMaintenanceStatus } from "../types"
import { parseMaintenanceStatus } from "./maintenance-status.ts"
import { LatestTaskCoordinator } from "./latest-task-coordinator.ts"

export interface MaintenanceStatusSnapshot {
  status: ChatMaintenanceStatus | null
  unavailable: boolean
}

/** Reads the host's maintenance route; resolves to the raw JSON or rejects. */
export type MaintenanceStatusLoader = () => Promise<unknown>

/**
 * Keeps the newest maintenance status for the chat's banner. Framework-free so the ordering can be
 * replayed deterministically; {@link useMaintenanceStatus} drives it from React.
 *
 * Operational status never hydrates conversation history or changes its lifecycle. One read runs
 * at a time and a burst collapses to one trailing read; a read that lands after a newer one began,
 * after a disconnect or after stop is dropped. An unavailable read is not evidence that a known
 * pause ended, so it keeps the last status and only marks it unavailable.
 */
export class MaintenanceStatusReader {
  private snapshot: MaintenanceStatusSnapshot = { status: null, unavailable: false }
  private revision = 0
  private running = false
  private readonly requests = new LatestTaskCoordinator<string>()

  private readonly load: MaintenanceStatusLoader
  private readonly publish: (snapshot: MaintenanceStatusSnapshot) => void

  constructor(load: MaintenanceStatusLoader, publish: (snapshot: MaintenanceStatusSnapshot) => void) {
    this.load = load
    this.publish = publish
  }

  current(): MaintenanceStatusSnapshot {
    return this.snapshot
  }

  start(): void {
    this.running = true
    this.refresh()
  }

  stop(): void {
    this.running = false
    ++this.revision
  }

  refresh(): Promise<void> {
    const read = ++this.revision
    return this.requests.run("maintenance", async () => {
      try {
        const next = parseMaintenanceStatus(await this.load())
        if (!next) throw new Error("Invalid maintenance status")
        if (!this.running || read !== this.revision) return
        this.set({ status: next, unavailable: false })
      } catch {
        if (!this.running || read !== this.revision) return
        this.set({ ...this.snapshot, unavailable: true })
      }
    }).catch(() => {})
  }

  /** The live connection dropped: whatever was read before can no longer be confirmed. */
  disconnected(): void {
    ++this.revision
    if (!this.running) return
    this.set({ ...this.snapshot, unavailable: true })
  }

  private set(snapshot: MaintenanceStatusSnapshot): void {
    this.snapshot = snapshot
    this.publish(snapshot)
  }
}
