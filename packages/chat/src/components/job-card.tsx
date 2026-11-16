import { useEffect, useState, type CSSProperties, type ReactNode } from "react"
import {
  ActionMenuItems, Dialog, DialogContent, DialogHeader, DialogTitle, DropdownMenu, DropdownMenuContent, DropdownMenuTrigger,
  type ContextMenuEntry,
} from "@redbamboo/ui"
import {
  capabilityLabel, formatJobDuration, isActiveJob, jobElapsed, jobProgress, jobStageWords,
  type ChatJob, type ChatJobKind,
} from "../lib/chat-jobs"
import { openMediaLightbox } from "./streaming-text"
import { AudioPlayerWidget } from "./audio-player-widget"

/**
 * A job in the chat is one square, the size of every other embed (80 px, like
 * an image or a voice line): its picture, blurred until it's ready, or the
 * job's icon over a soft blur of its colour. Progress is the ring around the
 * square, like a voice line playing. Nothing else: no caption, no buttons.
 *
 * The click opens the job's summary: what it made, what it was asked, where it
 * ran and how long it took, or what went wrong; Stop while it runs. The Compute
 * app's job page is an expert option in the summary's ⋯ menu, never the click.
 *
 * A square's size is fixed from its first frame to its last, so a job
 * progressing never moves the thread. Colour lives only in the ring and the
 * blur; "needs you" and "failed" colour the whole ring. No live region.
 */

const KIND: Record<ChatJobKind, { icon: string; color: string; noun: [string, string] }> = {
  image: { icon: "ph-bold ph-image-square", color: "var(--color-accent-gold)", noun: ["image", "images"] },
  video: { icon: "ph-bold ph-film-strip", color: "color-mix(in srgb, var(--color-accent-red) 55%, var(--color-accent-gold))", noun: ["video", "videos"] },
  audio: { icon: "ph-bold ph-music-notes", color: "color-mix(in srgb, var(--color-accent-purple) 70%, var(--color-text-primary))", noun: ["track", "tracks"] },
  workflow: { icon: "ph-bold ph-lightning", color: "var(--color-domain-technology)", noun: ["step", "steps"] },
  generic: { icon: "ph-bold ph-cube", color: "var(--color-accent-teal)", noun: ["output", "outputs"] },
}
/** The kind's colour, for the activity row's shape. */
export function jobKindColor(kind: ChatJobKind): string {
  return KIND[kind].color
}
const FAILED_COLOR = "var(--color-accent-red)"
const DONE_COLOR = "var(--color-domain-foundation)"
const NEEDS_COLOR = "var(--color-accent-gold)"
const OVERLAY = (alpha: number) => `rgb(from var(--contrast) r g b / ${alpha})`
const RING_TRACK = OVERLAY(0.08)
const RING_MASK: CSSProperties = {
  mask: "linear-gradient(#000 0 0) content-box exclude, linear-gradient(#000 0 0)",
  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
  WebkitMaskComposite: "xor",
}

export interface JobBodyProps {
  job: ChatJob
  resolveImageSrc?: (src: string) => string | undefined
}
/** What a square shows for its kind; null falls back to the kind's icon over its blur. */
export type JobBodyRenderer = (props: JobBodyProps) => ReactNode

/**
 * What a square shows, by kind. A new kind is one entry; a kind without one
 * shows its icon. The picture area is always 74 x 74 inside the ring.
 */
export const JOB_BODY_RENDERERS: Partial<Record<ChatJobKind, JobBodyRenderer>> = {
  // Called, not mounted: a renderer that has nothing to show must return null itself for the icon to stand in.
  image: props => imageSquare(props),
  video: props => videoSquare(props),
  audio: ({ job }) => job.state === "done" ? <Aura job={job} icon="ph-fill ph-play" /> : null,
}

export interface JobCardProps {
  job: ChatJob
  /** Stop a running job, from its summary. Its presence is the capability. */
  onStop?: (job: ChatJob) => Promise<void> | void
  resolveImageSrc?: (src: string) => string | undefined
}

export function JobCard({ job, onStop, resolveImageSrc }: JobCardProps) {
  const [summaryOpen, setSummaryOpen] = useState(false)
  const progress = jobProgress(job)
  const ring = ringOf(job, progress)
  const label = `${job.title}: ${summarySentence(job, progress, Date.now())}`
  return (
    <>
      <button
        type="button"
        data-slot="job-card"
        data-job-id={job.id}
        data-job-kind={job.kind}
        data-job-state={job.state}
        data-job-progress={progress !== null ? Math.round(progress * 100) : undefined}
        aria-label={label}
        aria-haspopup="dialog"
        title={label}
        onClick={() => setSummaryOpen(true)}
        className="group/job relative block size-20 shrink-0 cursor-pointer rounded-xl p-[3px] outline-none focus-visible:ring-2 focus-visible:ring-ring-a50"
        style={{ ["--job-kind" as string]: job.state === "failed" ? FAILED_COLOR : KIND[job.kind].color } as CSSProperties}
      >
        {/* The ring is its own layer, masked to the 3 px band, so it never shows through a translucent square. */}
        <span aria-hidden="true" data-slot="job-ring" className={`absolute inset-0 rounded-xl p-[3px] ${ring.spin ? "job-ring-spin" : ""}`}
          style={{ background: ring.background, ...RING_MASK }} />
        <span className={`relative block size-full overflow-hidden rounded-[9px] bg-overlay-6 ${job.state === "stopped" ? "opacity-70" : ""}`}>
          <JobSquare job={job} resolveImageSrc={resolveImageSrc} />
          <span aria-hidden="true" className="absolute inset-0 transition-colors duration-200 group-hover/job:bg-overlay-6" />
        </span>
      </button>
      {summaryOpen && <JobSummary job={job} onStop={onStop} resolveImageSrc={resolveImageSrc} onClose={() => setSummaryOpen(false)} />}
    </>
  )
}

/** The squares a turn launched, after its frieze: side by side, wrapping, like embeds. */
export function JobCards({ jobs, onStop, resolveImageSrc, className }: {
  jobs: readonly ChatJob[]
  onStop?: (job: ChatJob) => Promise<void> | void
  resolveImageSrc?: (src: string) => string | undefined
  className?: string
}) {
  if (!jobs.length) return null
  return (
    <div data-slot="job-cards" className={`flex w-full min-w-0 flex-wrap items-start gap-2 ${className ?? ""}`}>
      {jobs.map(job => <JobCard key={job.id} job={job} onStop={onStop} resolveImageSrc={resolveImageSrc} />)}
    </div>
  )
}

/** The ring: real progress fills clockwise from the top; no real progress spins an arc; "needs you" and "failed" are a full ring. */
function ringOf(job: ChatJob, progress: number | null): { background: string; spin: boolean } {
  switch (job.state) {
    case "running":
      if (progress !== null) {
        const percent = progress * 100
        return { background: `conic-gradient(from -90deg, var(--job-kind) ${percent}%, ${RING_TRACK} ${percent}%)`, spin: false }
      }
      return { background: `conic-gradient(from var(--job-ring-from, -90deg), var(--job-kind) 0 22%, ${RING_TRACK} 22%)`, spin: true }
    case "needs-you":
      return { background: NEEDS_COLOR, spin: false }
    case "failed":
      return { background: `color-mix(in srgb, ${FAILED_COLOR} 70%, transparent)`, spin: false }
    default:
      return { background: RING_TRACK, spin: false }
  }
}

function JobSquare({ job, resolveImageSrc }: JobBodyProps) {
  if (job.state === "failed") {
    return (
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-[22px]"
        style={{ color: FAILED_COLOR, background: `color-mix(in srgb, ${FAILED_COLOR} 12%, transparent)` }}>
        <i className="ph-bold ph-warning" />
      </span>
    )
  }
  return JOB_BODY_RENDERERS[job.kind]?.({ job, resolveImageSrc }) ?? <Aura job={job} icon={KIND[job.kind].icon} />
}

/** The job's icon over a soft blur of its colour; shimmering while it works, a check once it's done. */
function Aura({ job, icon }: { job: ChatJob; icon: string }) {
  const muted = job.state === "queued" || job.state === "stopped"
  const working = job.state === "running" || job.state === "needs-you"
  return (
    <>
      {!muted && (
        <span aria-hidden="true" className="absolute -inset-3 blur-lg" style={{
          background: "radial-gradient(circle at 30% 28%, color-mix(in srgb, var(--job-kind) 42%, transparent), transparent 62%), "
            + "radial-gradient(circle at 72% 78%, color-mix(in srgb, var(--job-kind) 26%, transparent), transparent 60%)",
        }} />
      )}
      {working && <span aria-hidden="true" className="job-shimmer absolute inset-0" />}
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-[22px] drop-shadow-sm"
        style={{ color: muted ? "var(--color-text-muted)" : "var(--color-text-primary)" }}>
        <i className={job.state === "stopped" ? "ph-bold ph-stop" : icon} />
      </span>
      {job.state === "done" && <DoneBadge />}
    </>
  )
}

function DoneBadge() {
  return (
    <span aria-hidden="true" className="absolute right-1 bottom-1 z-10 grid size-4 place-items-center rounded-full bg-black/45 text-[10px] text-white">
      <i className="ph-bold ph-check" />
    </span>
  )
}

type JobMedia = { src: string; type: "image" | "video" | "audio"; key: string }

/** What a job made, in order: a finished job's outputs, or its finished parts' outputs. */
function jobMedia(job: ChatJob): JobMedia[] {
  const typeOf = (contentType: string | null | undefined, fallback: ChatJobKind): JobMedia["type"] | null => {
    const major = (contentType ?? "").split("/")[0]
    if (major === "image" || major === "video" || major === "audio") return major
    return fallback === "image" || fallback === "video" || fallback === "audio" ? fallback : null
  }
  const collect = (source: ChatJob): JobMedia[] => source.outputs.flatMap((output, index) => {
    const type = typeOf(output.contentType, source.kind)
    return type && output.url ? [{ src: output.url, type, key: `${source.id}:${index}` }] : []
  })
  if (job.children.length) return job.children.filter(child => child.state === "done").flatMap(collect)
  return job.state === "done" ? collect(job) : []
}

/**
 * The picture. While the job works, the first finished part shows blurred
 * under the icon; once it's done, the image itself, or a 2 x 2 mosaic with
 * "+N" for a batch. Before any picture exists, the kind's icon.
 */
function imageSquare({ job, resolveImageSrc }: JobBodyProps): ReactNode {
  const images = jobMedia(job).filter(item => item.type === "image")
  if (!images.length) return null
  const resolve = (src: string) => resolveImageSrc?.(src) ?? src
  if (job.state !== "done") {
    return (
      <>
        <SquareImage src={resolve(images[0].src)} blurred />
        <span aria-hidden="true" className="absolute inset-0 grid place-items-center text-[22px] text-white drop-shadow-md">
          <i className={KIND.image.icon} />
        </span>
      </>
    )
  }
  if (images.length === 1) return <SquareImage src={resolve(images[0].src)} />
  return (
    <span data-slot="job-tiles" className="absolute inset-0 grid grid-cols-2 grid-rows-2 gap-0.5">
      {images.slice(0, 4).map(item => <span key={item.key} className="relative overflow-hidden"><SquareImage src={resolve(item.src)} /></span>)}
      {images.length > 4 && (
        <span className="absolute right-1 bottom-1 z-10 rounded-[5px] bg-black/55 px-[5px] text-[10px] font-semibold text-white">+{images.length - 4}</span>
      )}
    </span>
  )
}

/** One picture: shimmers until it arrives, then develops out of a blur (or stays blurred while the job works). */
function SquareImage({ src, blurred = false }: { src: string; blurred?: boolean }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  if (failed) return null
  const clear = loaded && !blurred
  return (
    <>
      {!loaded && <span aria-hidden="true" className="job-shimmer absolute inset-0" />}
      <img
        src={src}
        alt=""
        loading="lazy"
        decoding="async"
        data-developed={clear || undefined}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={`absolute inset-0 block size-full object-cover transition-[filter,opacity,transform] duration-700 ease-out motion-reduce:transition-none ${
          !loaded ? "scale-110 opacity-0 blur-md" : blurred ? "scale-110 opacity-80 blur-[6px]" : "opacity-100 blur-none"}`}
      />
    </>
  )
}

/** A finished video: its first frame with a play glyph. */
function videoSquare({ job }: JobBodyProps): ReactNode {
  const video = jobMedia(job).find(item => item.type === "video")
  if (!video) return null
  return (
    <>
      <video src={video.src} muted playsInline preload="metadata" className="absolute inset-0 block size-full object-cover" />
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/20 text-white">
        <i className="ph-fill ph-play text-lg drop-shadow-md" />
      </span>
    </>
  )
}

function useNow(ticking: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!ticking) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [ticking])
  return now
}

/** Local time; the date too when it isn't today. */
function formatMoment(iso: string | null): string | null {
  const at = iso ? new Date(iso) : null
  if (!at || Number.isNaN(at.getTime())) return null
  const time = at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  return at.toDateString() === new Date().toDateString()
    ? time
    : `${at.toLocaleDateString([], { day: "numeric", month: "short" })}, ${time}`
}

/** The state as one sentence: the square's label and the summary's first line. */
function summarySentence(job: ChatJob, progress: number | null, now: number): string {
  switch (job.state) {
    case "queued": return "Waiting to start"
    case "running": {
      const words = jobStageWords(job)
      if (progress !== null) return [`${Math.round(progress * 100)}% done`, words].filter(Boolean).join(", ")
      const elapsed = jobElapsed(job, now)
      const lead = words ? words[0].toUpperCase() + words.slice(1) : "Running"
      return elapsed !== null ? `${lead} for ${formatJobDuration(elapsed)}` : lead
    }
    case "needs-you": return "Waiting for you"
    case "done": return job.durationMs !== null ? `Done in ${formatJobDuration(job.durationMs)}` : "Done"
    case "failed": return progress !== null ? `Failed at ${Math.round(progress * 100)}%` : "Failed"
    case "stopped": return "Stopped before it finished"
    default: return ""
  }
}

const STEP_WORDS: Record<ChatJob["state"], string> = {
  queued: "Waiting", running: "Running", "needs-you": "Needs you", done: "Done", failed: "Failed", stopped: "Stopped",
}

/**
 * The job in a glance: what it made, what it was asked, where it ran and how
 * long it took, or what went wrong. Plain words, no ids; the Compute page in
 * the ⋯ menu has the rest. Live while the job runs.
 */
function JobSummary({ job, onStop, resolveImageSrc, onClose }: {
  job: ChatJob
  onStop?: (job: ChatJob) => Promise<void> | void
  resolveImageSrc?: (src: string) => string | undefined
  onClose: () => void
}) {
  const kind = KIND[job.kind]
  const progress = jobProgress(job)
  const now = useNow(job.state === "running")
  const [stopping, setStopping] = useState(false)
  const media = jobMedia(job)
  const images = media.filter(item => item.type === "image")
  const videos = media.filter(item => item.type === "video")
  const tracks = media.filter(item => item.type === "audio")
  const color = job.state === "failed" ? FAILED_COLOR : kind.color
  const sentenceColor = job.state === "done" ? DONE_COLOR
    : job.state === "failed" ? FAILED_COLOR
      : job.state === "needs-you" ? NEEDS_COLOR
        : undefined
  const facts: [string, string][] = []
  facts.push(["Made with", job.provider ? `${job.provider} · ${capabilityLabel(job.capability)}` : capabilityLabel(job.capability)])
  const started = formatMoment(job.startedAt ?? job.queuedAt)
  if (started) facts.push([job.startedAt ? "Started" : "Asked", started])
  const ended = isActiveJob(job) ? null : formatMoment(job.completedAt)
  if (ended) facts.push([job.state === "done" ? "Finished" : "Ended", ended])
  if (job.durationMs !== null && !isActiveJob(job)) facts.push(["Took", formatJobDuration(job.durationMs)])
  if (media.length > 1) facts.push(["Results", `${media.length} ${kind.noun[1]}`])
  const steps = job.children.length && job.kind !== "image" ? job.children : []
  const canStop = !!onStop && isActiveJob(job)
  const menu: ContextMenuEntry[] = job.href
    ? [{ id: "compute", label: "Open in Compute", icon: "ph-bold ph-arrow-square-out", attributes: { "data-job-link": job.href },
        run: ctx => { onClose(); ctx.navigate(job.href!) } }]
    : []

  return (
    <Dialog open onOpenChange={open => { if (!open) onClose() }}>
      <DialogContent
        motion="snappy"
        data-slot="job-summary"
        data-job-id={job.id}
        className="flex max-h-[82vh] max-w-md flex-col gap-0 p-0 sm:max-w-lg"
        style={{ ["--job-kind" as string]: color } as CSSProperties}
      >
        <DialogHeader className="shrink-0 flex-row items-center gap-3 border-b border-border-subtle py-3 pr-11 pl-4 text-left">
          <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-[9px] text-[17px]"
            style={{ color: "var(--job-kind)", background: "color-mix(in srgb, var(--job-kind) 17%, transparent)" }}>
            <i className={job.state === "failed" ? "ph-bold ph-warning" : kind.icon} />
          </span>
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm">{job.title}</DialogTitle>
            <p data-job-summary-status="" className="m-0 text-xs text-text-muted" style={sentenceColor ? { color: sentenceColor } : undefined}>
              {summarySentence(job, progress, now)}
            </p>
          </div>
          {menu.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger
                data-job-menu=""
                aria-label="More"
                title="More"
                className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-overlay-10 hover:text-contrast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring-a50"
              >
                <i aria-hidden="true" className="ph-bold ph-dots-three text-base" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" sideOffset={4}>
                <ActionMenuItems entries={menu} />
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </DialogHeader>
        {job.state === "running" && (
          <span aria-hidden="true" className="relative block h-[2px] shrink-0 overflow-hidden" style={{ background: "color-mix(in srgb, var(--job-kind) 14%, transparent)" }}>
            <span className={`block h-full ${progress === null ? "job-hairline-indeterminate" : "transition-[width] duration-500 ease-out"}`}
              style={{ background: "var(--job-kind)", ...(progress === null ? {} : { width: `${progress * 100}%` }) }} />
          </span>
        )}
        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-4 py-4">
          {images.length > 0 && (
            <div data-slot="job-summary-images" className={images.length === 1 ? "flex justify-center" : "grid grid-cols-3 gap-1.5"}>
              {images.map(item => {
                const src = resolveImageSrc?.(item.src) ?? item.src
                return (
                  // The lightbox takes the summary's place: two modals never stack.
                  <button key={item.key} type="button" aria-label="Open image" onClick={() => { onClose(); openMediaLightbox(src, "image") }}
                    className={`cursor-zoom-in overflow-hidden rounded-lg border border-overlay-10 bg-overlay-4 p-0 ${images.length === 1 ? "" : "aspect-square"}`}>
                    <img src={src} alt="" loading="lazy" decoding="async"
                      className={images.length === 1 ? "block max-h-[360px] max-w-full object-contain" : "block size-full object-cover"} />
                  </button>
                )
              })}
            </div>
          )}
          {videos.map(item => (
            <video key={item.key} src={item.src} controls playsInline preload="metadata"
              className="block max-h-[360px] w-full rounded-lg border border-overlay-10 bg-black" />
          ))}
          {tracks.length > 0 && (
            <div data-slot="job-summary-tracks" className="flex flex-wrap gap-2">
              {tracks.map(item => <AudioPlayerWidget key={item.key} src={item.src} />)}
            </div>
          )}
          {steps.length > 0 && (
            <ol data-slot="job-summary-steps" className="m-0 flex list-none flex-col gap-1 p-0 text-[12.5px]">
              {steps.map(step => (
                <li key={step.id} data-step-state={step.state} className="flex items-center gap-2">
                  <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full"
                    style={{ background: step.state === "done" ? "var(--job-kind)" : step.state === "failed" ? FAILED_COLOR : OVERLAY(0.25) }} />
                  <span className="min-w-0 flex-1 truncate text-text-primary">{step.title}</span>
                  <span className="shrink-0 text-text-muted tabular-nums">
                    {step.state === "running" && step.progress !== null ? `${Math.round(step.progress * 100)}%` : STEP_WORDS[step.state]}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {job.state === "failed" && (
            <div role="alert" className="rounded-lg border px-3 py-2 text-[12.5px] leading-relaxed break-words whitespace-pre-wrap"
              style={{ color: FAILED_COLOR, borderColor: `color-mix(in srgb, ${FAILED_COLOR} 35%, transparent)`, background: `color-mix(in srgb, ${FAILED_COLOR} 8%, transparent)` }}>
              {job.errorMessage ?? "It stopped without saying why."}
            </div>
          )}
          {job.prompt && (
            <div data-slot="job-summary-prompt">
              <div className="mb-1 text-[11px] font-semibold tracking-wide text-text-muted uppercase">Asked for</div>
              <p className="m-0 max-h-40 overflow-y-auto text-[13px] leading-relaxed break-words whitespace-pre-wrap text-text-primary">{job.prompt}</p>
            </div>
          )}
          <dl data-slot="job-summary-facts" className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[12.5px]">
            {facts.map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-text-muted">{label}</dt>
                <dd className="m-0 truncate text-text-primary tabular-nums" title={value}>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
        {canStop && (
          <div className="flex shrink-0 justify-end border-t border-border-subtle px-4 py-2.5">
            <button
              type="button"
              data-job-stop=""
              disabled={stopping}
              onClick={async () => {
                setStopping(true)
                try { await onStop!(job) } catch { /* The job keeps its state; the next read says what happened. */ }
                finally { setStopping(false) }
              }}
              className="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors hover:bg-overlay-6 disabled:opacity-50"
              style={{ color: FAILED_COLOR }}
            >
              <i aria-hidden="true" className="ph-bold ph-stop-circle" />{stopping ? "Stopping…" : "Stop"}
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
