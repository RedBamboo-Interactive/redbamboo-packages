import { createContext, useContext, useRef, useSyncExternalStore, type CSSProperties } from "react"
import { jobProgress, type ChatJob } from "../lib/chat-jobs"
import { PART_COLOR } from "../lib/part-colors"
import { friezeMarkerColor } from "../lib/frieze-presentation"
import { summarySentence } from "./job-summary"

/**
 * A job in the thread uses the same footprint as a tool square, positioned
 * beside the call that launched it when known. Magenta denotes delegated work.
 *
 * It fills left to right with the job's real progress (gliding to each new
 * value), a short segment sweeps through it while running without real
 * progress. With real progress it wobbles like an in-flight square. Queued is an
 * outline; done is solid; failed is solid red; needs-you is solid gold with a
 * soft pulse; stopped is grey with the fill it reached. Its size never changes,
 * so a job progressing never moves the row or the thread.
 *
 * The click opens the job's summary in the squares' dialog. Styles live in the
 * shared tokens (`.job-twin`), since hosts only load those.
 */

/** The twin's colour by state: magenta, red when it failed, gold when it needs you, grey when stopped. */
export function jobTwinColor(job: Pick<ChatJob, "state">): string {
  switch (job.state) {
    case "failed": return PART_COLOR.error
    case "needs-you": return "var(--color-accent-gold)"
    case "stopped": return "var(--color-text-disabled)"
    default: return PART_COLOR.delegation
  }
}

/** Title and plain status: the twin's accessible name and tooltip. */
export function jobTwinLabel(job: ChatJob, now = Date.now()): string {
  return `${job.title}: ${summarySentence(job, jobProgress(job), now)}`
}

export function JobTwin({ job, onOpen, quiet = false }: { job: ChatJob; onOpen: () => void; quiet?: boolean }) {
  const progress = jobProgress(job)
  // A stopped job keeps the fill it reached: the cancelled record's kept progress, else what this twin last showed.
  const reached = useRef(0)
  if (job.state === "running" && progress !== null) reached.current = progress * 100
  const fill = job.state === "running" ? (progress ?? 0) * 100
    : job.state === "stopped" ? (job.stoppedProgress != null ? job.stoppedProgress * 100 : reached.current)
      : job.state === "queued" ? 0
        : 100
  const label = jobTwinLabel(job)
  const color = friezeMarkerColor(quiet ? "quiet" : "detailed", jobTwinColor(job), {
    active: job.state === "running", failed: job.state === "failed", needsAttention: job.state === "needs-you",
  })
  return (
    <button
      type="button"
      data-slot="job-twin"
      data-job-id={job.id}
      data-job-kind={job.kind}
      data-job-state={job.state}
      data-job-progress={progress !== null ? Math.round(progress * 100) : undefined}
      aria-label={label}
      aria-haspopup="dialog"
      title={label}
      onClick={onOpen}
      className="job-twin relative block size-2.5 shrink-0 cursor-pointer overflow-hidden rounded-[2px] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      style={{ ["--job-twin-c" as string]: color, ["--job-twin-p" as string]: `${fill}%`, ...(quiet ? { width: 8, height: 8 } : {}) } as CSSProperties}
    >
      {job.state === "running" && progress === null && <span aria-hidden="true" className="job-twin-sweep" />}
    </button>
  )
}

/**
 * The panel's current jobs, for a squares' dialog stepping onto a twin drawn
 * by another row: that row's memoized message doesn't re-render the dialog's
 * own row, so the dialog subscribes here and follows the job live. A stable
 * object, like the activity rows getter.
 */
export interface ChatJobsStore {
  get(id: string): ChatJob | undefined
  subscribe(listener: () => void): () => void
  /** Stop a running job from its summary; absent when the host can't. */
  readonly stop: ((job: ChatJob) => Promise<void> | void) | undefined
}

export interface WritableChatJobsStore extends ChatJobsStore {
  /** Called while the panel renders; `notify` after it commits. */
  update(jobs: readonly ChatJob[], stop: ((job: ChatJob) => Promise<void> | void) | undefined): void
  notify(): void
}

export function createChatJobsStore(): WritableChatJobsStore {
  let byId = new Map<string, ChatJob>()
  let current: ((job: ChatJob) => Promise<void> | void) | undefined
  const stop = (job: ChatJob) => current?.(job)
  const listeners = new Set<() => void>()
  return {
    get: id => byId.get(id),
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener) } },
    get stop() { return current ? stop : undefined },
    update(jobs, next) {
      byId = new Map(jobs.map(job => [job.id, job] as const))
      current = next
    },
    notify() { for (const listener of [...listeners]) listener() },
  }
}

export const ChatJobsContext = createContext<ChatJobsStore | null>(null)

const NO_SUBSCRIPTION = () => () => {}

/** The job `id`, live from the panel's store; else from the jobs this row was given. */
export function useLiveJob(id: string | undefined, own?: readonly ChatJob[]): ChatJob | undefined {
  const store = useContext(ChatJobsContext)
  const fromStore = useSyncExternalStore(store ? store.subscribe : NO_SUBSCRIPTION, () => (id && store ? store.get(id) : undefined))
  if (!id) return undefined
  return fromStore ?? own?.find(job => job.id === id)
}

export function useChatJobsStore(): ChatJobsStore | null {
  return useContext(ChatJobsContext)
}
