import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  capabilityLabel, formatJobDuration, isActiveJob, jobElapsed, jobProgress, jobStageWords,
  type ChatJob, type ChatJobKind,
} from "../lib/chat-jobs"

/**
 * One card per job, in the agent message that launched it. Colour lives only
 * in the kind's icon tile, the ring and the hairline; only "needs you" and
 * "failed" tint the card. A percentage only when the job reports real
 * progress; otherwise a spinner, the elapsed time and the stage in words.
 * The whole card opens the job. No live region: progress is read on demand.
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

export interface JobBodyProps {
  job: ChatJob
  resolveImageSrc?: (src: string) => string | undefined
}
export type JobBodyRenderer = (props: JobBodyProps) => ReactNode

/**
 * The body under a card's header, by kind. A new kind is one entry; a kind
 * without one gets the header and the hairline only.
 */
export const JOB_BODY_RENDERERS: Partial<Record<ChatJobKind, JobBodyRenderer>> = {
  image: props => <ImageTiles {...props} />,
  video: props => <VideoBody {...props} />,
  audio: props => <AudioBody {...props} />,
  workflow: props => <WorkflowSteps {...props} />,
}

export interface JobCardProps {
  job: ChatJob
  /** A finished job the reply already shows: one line that still opens it. */
  collapsed?: boolean
  /** Stop a running job. Its presence is the capability. */
  onStop?: (job: ChatJob) => Promise<void> | void
  resolveImageSrc?: (src: string) => string | undefined
}

export function JobCard({ job, collapsed = false, onStop, resolveImageSrc }: JobCardProps) {
  if (collapsed || job.state === "stopped") return <JobChip job={job} />
  const kind = KIND[job.kind]
  const color = job.state === "failed" ? FAILED_COLOR : kind.color
  const progress = jobProgress(job)
  const running = job.state === "running"
  // A queued job has nothing to show yet, unless its steps or batch are already known.
  const body = job.state === "failed"
    ? job.errorMessage ? <ErrorLine message={job.errorMessage} /> : null
    : job.state === "queued" && !job.children.length ? null
    : JOB_BODY_RENDERERS[job.kind]?.({ job, resolveImageSrc }) ?? null
  const cardStyle: CSSProperties = {
    ["--job-kind" as string]: color,
    ...(job.state === "failed" ? { borderColor: `color-mix(in srgb, ${FAILED_COLOR} 45%, rgb(from var(--contrast) r g b / 0.10))` } : {}),
    ...(job.state === "needs-you" ? {
      borderColor: `color-mix(in srgb, ${NEEDS_COLOR} 55%, rgb(from var(--contrast) r g b / 0.10))`,
      background: `color-mix(in srgb, ${NEEDS_COLOR} 8%, rgb(from var(--contrast) r g b / 0.04))`,
    } : {}),
  }
  return (
    <div
      data-slot="job-card"
      data-job-id={job.id}
      data-job-kind={job.kind}
      data-job-state={job.state}
      className="group/job relative grid w-full max-w-[440px] grid-cols-[28px_minmax(0,1fr)_auto] items-center gap-x-2.5 overflow-hidden rounded-[11px] border border-overlay-10 bg-overlay-4 hover:bg-overlay-6 pt-[9px] pr-[11px] pb-[11px] pl-2.5 text-[13px] leading-[1.4] transition-colors duration-200 hover:border-[color-mix(in_srgb,var(--job-kind)_45%,rgb(from_var(--contrast)_r_g_b_/_0.10))] focus-within:border-[color-mix(in_srgb,var(--job-kind)_45%,rgb(from_var(--contrast)_r_g_b_/_0.10))]"
      style={cardStyle}
    >
      <KindTile job={job} />
      <div className="flex min-w-0 flex-col">
        <JobTitleLink job={job} />
        <JobSubtitle job={job} />
      </div>
      <div className="relative z-10 inline-flex items-center gap-[7px] text-[11.5px] tabular-nums text-text-muted">
        {onStop && isActiveJob(job) && <StopButton job={job} onStop={onStop} />}
        <JobStatus job={job} progress={progress} />
        {job.href && <i aria-hidden="true" className="ph-bold ph-arrow-up-right text-[13px] opacity-0 transition-opacity duration-200 group-hover/job:opacity-90 group-focus-within/job:opacity-90 [@media(hover:none)]:opacity-90" />}
      </div>
      {body && <div data-slot="job-card-body" className="col-span-3 mt-2.5 min-w-0">{body}</div>}
      {running && <Hairline progress={progress} />}
    </div>
  )
}

/** The cards a turn launched, after its frieze. */
export function JobCards({ jobs, collapsed, onStop, resolveImageSrc, className }: {
  jobs: readonly ChatJob[]
  /** Ids of finished jobs that shrink to a chip. */
  collapsed?: ReadonlySet<string>
  onStop?: (job: ChatJob) => Promise<void> | void
  resolveImageSrc?: (src: string) => string | undefined
  className?: string
}) {
  if (!jobs.length) return null
  return (
    <div data-slot="job-cards" className={`flex w-full min-w-0 flex-col items-start gap-1.5 ${className ?? ""}`}>
      {jobs.map(job => (
        <JobCard key={job.id} job={job} collapsed={collapsed?.has(job.id)} onStop={onStop} resolveImageSrc={resolveImageSrc} />
      ))}
    </div>
  )
}

function KindTile({ job }: { job: ChatJob }) {
  const icon = job.state === "failed" ? "ph-bold ph-warning" : KIND[job.kind].icon
  return (
    <span
      aria-hidden="true"
      className="grid size-7 place-items-center rounded-lg text-[15px]"
      style={{ color: "var(--job-kind)", background: "color-mix(in srgb, var(--job-kind) 17%, transparent)" }}
    >
      <i className={icon} />
    </span>
  )
}

function JobTitleLink({ job }: { job: ChatJob }) {
  const className = "truncate text-[13px] font-semibold text-text-primary no-underline outline-none"
  if (!job.href) return <span className={className}>{job.title}</span>
  // The title is the card's one link; its hit area is stretched over the whole card.
  return (
    <a
      href={job.href}
      data-job-link=""
      className={`${className} after:absolute after:inset-0 after:z-0 after:rounded-[inherit] after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring`}
    >
      {job.title}
    </a>
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

function countWords(job: ChatJob): string | null {
  const noun = KIND[job.kind].noun
  if (job.children.length) {
    const done = job.children.filter(child => child.state === "done").length
    if (job.state === "done") return `${job.children.length} ${job.children.length === 1 ? noun[0] : noun[1]}`
    return `${done} of ${job.children.length}`
  }
  if (job.state === "done" && job.outputs.length > 1) return `${job.outputs.length} ${noun[1]}`
  return null
}

function JobSubtitle({ job }: { job: ChatJob }) {
  const parts: string[] = []
  parts.push(job.provider ?? capabilityLabel(job.capability))
  const progress = jobProgress(job)
  if (job.state === "queued" || (job.state === "running" && progress === null)) {
    const words = jobStageWords(job)
    if (words) parts.push(words)
  }
  const count = countWords(job)
  if (count) parts.push(count)
  if (job.state === "done" && job.durationMs !== null) parts.push(`took ${formatJobDuration(job.durationMs)}`)
  return (
    <span className="flex min-w-0 gap-[5px] overflow-hidden text-[11.5px] whitespace-nowrap text-text-muted">
      {parts.map((part, index) => (
        <span key={index} className="truncate">
          {index > 0 && <span aria-hidden="true" className="mr-[5px] opacity-70">·</span>}
          {part}
        </span>
      ))}
    </span>
  )
}

function JobStatus({ job, progress }: { job: ChatJob; progress: number | null }) {
  const now = useNow(job.state === "running" && progress === null)
  switch (job.state) {
    case "queued":
      return <><span aria-hidden="true" className="box-border size-4 shrink-0 rounded-full border-[1.5px] border-dashed border-text-muted/75" />Queued</>
    case "running": {
      if (progress !== null) {
        const percent = Math.round(progress * 100)
        return (
          <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${job.title} progress`}
            className="inline-flex items-center gap-[7px]">
            <Ring progress={progress} />{percent}%
          </span>
        )
      }
      const elapsed = jobElapsed(job, now)
      return <><Ring spinning />{elapsed !== null ? formatJobDuration(elapsed) : "Running"}</>
    }
    case "done":
      return <Pill color={DONE_COLOR} icon="ph-bold ph-check">Done</Pill>
    case "failed":
      return <Pill color={FAILED_COLOR}>Failed</Pill>
    case "needs-you":
      return <Pill color={NEEDS_COLOR} dot>Needs you</Pill>
    default:
      return null
  }
}

/** Determinate ring, or a spinning arc; colour from the card's kind. */
function Ring({ progress = 0.28, spinning = false }: { progress?: number; spinning?: boolean }) {
  const mask = "radial-gradient(circle, transparent 5px, #000 5.6px)"
  return (
    <span
      aria-hidden="true"
      className={`size-4 shrink-0 rounded-full ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`}
      style={{
        background: `conic-gradient(var(--job-kind) ${progress * 100}%, color-mix(in srgb, var(--job-kind) 20%, transparent) 0)`,
        WebkitMask: mask,
        mask,
      }}
    />
  )
}

function Pill({ color, icon, dot = false, children }: { color: string; icon?: string; dot?: boolean; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-[5px] rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ color, background: `color-mix(in srgb, ${color} 18%, transparent)` }}
    >
      {icon && <i aria-hidden="true" className={`${icon} text-xs`} />}
      {dot && <span aria-hidden="true" className="job-pulse size-1.5 rounded-full bg-current" />}
      {children}
    </span>
  )
}

function StopButton({ job, onStop }: { job: ChatJob; onStop: (job: ChatJob) => Promise<void> | void }) {
  const [stopping, setStopping] = useState(false)
  return (
    <button
      type="button"
      data-job-stop=""
      aria-label={`Stop ${job.title}`}
      title="Stop"
      disabled={stopping}
      onClick={async () => {
        setStopping(true)
        try { await onStop(job) } catch { /* The card keeps its state; the next read says what happened. */ }
        finally { setStopping(false) }
      }}
      className="inline-flex size-5 items-center justify-center rounded-md bg-overlay-6 text-text-muted opacity-0 transition-opacity duration-200 hover:text-text-primary focus-visible:opacity-100 disabled:opacity-40 group-hover/job:opacity-100 [@media(hover:none)]:opacity-100"
    >
      <span aria-hidden="true" className="size-[7px] rounded-[1.5px] bg-current" />
    </button>
  )
}

/** The only progress bar: 2 px along the bottom edge. */
function Hairline({ progress }: { progress: number | null }) {
  return (
    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px] overflow-hidden" style={{ background: "color-mix(in srgb, var(--job-kind) 12%, transparent)" }}>
      <span
        className={`block h-full ${progress === null ? "job-hairline-indeterminate" : "transition-[width] duration-500 ease-out"}`}
        style={{ background: "var(--job-kind)", ...(progress === null ? {} : { width: `${progress * 100}%` }) }}
      />
    </span>
  )
}

function ErrorLine({ message }: { message: string }) {
  return (
    <div className="rounded-[7px] px-[9px] py-1.5 font-mono text-[11.5px] break-words whitespace-pre-wrap" style={{ color: FAILED_COLOR, background: `color-mix(in srgb, ${FAILED_COLOR} 9%, transparent)` }}>
      {message.length > 400 ? `${message.slice(0, 399)}…` : message}
    </div>
  )
}

function outputUrl(job: ChatJob, type: string): string | null {
  return job.outputs.find(output => (output.contentType ?? "").startsWith(`${type}/`))?.url ?? job.outputs[0]?.url ?? null
}

/** Tiles keep their 16:10 box from the start, so an image arriving never moves the conversation. */
function ImageTiles({ job, resolveImageSrc }: JobBodyProps) {
  const tiles: { key: string; src: string | null; running: boolean; progress: number | null }[] = job.children.length
    ? job.children.map(child => ({
        key: child.id,
        src: child.state === "done" ? outputUrl(child, "image") : null,
        running: child.state === "running",
        progress: child.progress,
      }))
    : job.state === "done" && job.outputs.length
      ? job.outputs.slice(0, 8).map((output, index) => ({ key: `${job.id}:${index}`, src: output.url, running: false, progress: null }))
      : [{ key: job.id, src: null, running: job.state === "running", progress: job.progress }]
  // A lone image takes half the card instead of a quarter; two or three share the row; four or more keep four columns.
  const columns = tiles.length >= 4 ? "grid-cols-4" : tiles.length === 3 ? "grid-cols-3" : "grid-cols-2"
  return (
    <div data-slot="job-tiles" className={`grid ${columns} gap-1.5`}>
      {tiles.map(({ key, ...tile }) => <ImageTile key={key} {...tile} resolveImageSrc={resolveImageSrc} />)}
    </div>
  )
}

function ImageTile({ src, running, progress, resolveImageSrc }: { src: string | null; running: boolean; progress: number | null; resolveImageSrc?: (src: string) => string | undefined }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const resolved = src ? resolveImageSrc?.(src) ?? src : null
  return (
    <div data-slot="job-tile" data-developed={loaded || undefined} className="relative aspect-[16/10] overflow-hidden rounded-md bg-overlay-6">
      {(!resolved || !loaded || failed) && <span aria-hidden="true" className="job-shimmer absolute inset-0" />}
      {resolved && !failed && (
        <img
          src={resolved}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={`block size-full object-cover transition-[filter,opacity,transform] duration-700 ease-out motion-reduce:transition-none ${loaded ? "opacity-100 blur-none" : "scale-110 opacity-0 blur-md"}`}
        />
      )}
      {running && (
        <span aria-hidden="true" className="absolute bottom-0 left-0 h-[2px]" style={{ background: "var(--job-kind)", width: `${Math.max(8, (progress ?? 0.55) * 100)}%` }} />
      )}
    </div>
  )
}

function VideoBody({ job }: JobBodyProps) {
  const src = job.state === "done" ? outputUrl(job, "video") : null
  if (src) {
    return (
      <video
        src={src}
        controls
        preload="metadata"
        className="relative z-10 block h-[120px] max-w-full rounded-[7px] bg-overlay-6"
      />
    )
  }
  const filled = Math.round((jobProgress(job) ?? 0) * 24)
  return (
    <div className="relative h-[74px] overflow-hidden rounded-[7px] bg-overlay-6">
      <span aria-hidden="true" className="job-shimmer absolute inset-0" />
      <div aria-hidden="true" className="absolute inset-x-2 bottom-2 grid grid-cols-[repeat(24,minmax(0,1fr))] gap-0.5">
        {Array.from({ length: 24 }, (_, index) => (
          <i key={index} className="h-[5px] rounded-[1px]" style={{ background: index < filled ? "var(--job-kind)" : "rgb(from var(--contrast) r g b / 0.14)" }} />
        ))}
      </div>
    </div>
  )
}

/** Deterministic bar heights per job: the same job always draws the same wave. */
function waveHeights(seed: string, count: number): number[] {
  let hash = 2166136261
  for (const char of seed) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
  return Array.from({ length: count }, () => {
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177)
    return 25 + ((hash >>> 0) % 75)
  })
}

function Wave({ seed, filled, count = 40 }: { seed: string; filled: number; count?: number }) {
  const heights = useMemo(() => waveHeights(seed, count), [seed, count])
  return (
    <div aria-hidden="true" className="flex h-[26px] min-w-0 flex-1 items-center gap-0.5">
      {heights.map((height, index) => (
        <i key={index} className="min-w-0 flex-1 rounded-[2px]" style={{ height: `${height}%`, background: index / count < filled ? "var(--job-kind)" : "rgb(from var(--contrast) r g b / 0.12)" }} />
      ))}
    </div>
  )
}

function AudioBody({ job }: JobBodyProps) {
  const src = job.state === "done" ? outputUrl(job, "audio") : null
  if (src) return <CompactPlayer seed={job.id} src={src} title={job.title} />
  return <Wave seed={job.id} filled={jobProgress(job) ?? 0} />
}

/** A play button, the wave filling as it plays, and the time. Above the card's link. */
function CompactPlayer({ seed, src, title }: { seed: string; src: string; title: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  return (
    <div className="relative z-10 flex items-center gap-2.5" data-context-media="audio" data-context-media-src={src}>
      <audio
        ref={audio}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0) }}
        onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={event => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
      />
      <button
        type="button"
        aria-label={playing ? `Pause ${title}` : `Play ${title}`}
        onClick={() => {
          const element = audio.current
          if (!element) return
          if (element.paused) void element.play().catch(() => {})
          else element.pause()
        }}
        className="grid size-7 shrink-0 place-items-center rounded-full text-white"
        style={{ background: "var(--job-kind)" }}
      >
        <i aria-hidden="true" className={`ph-fill ${playing ? "ph-pause" : "ph-play"} text-xs`} />
      </button>
      <Wave seed={seed} filled={duration > 0 ? position / duration : 0} />
      <small className="shrink-0 text-[11.5px] tabular-nums text-text-muted">
        {formatJobDuration(position * 1000)} / {duration > 0 ? formatJobDuration(duration * 1000) : "–:––"}
      </small>
    </div>
  )
}

/** Segments only when the job has steps (its children); otherwise the header says it all. */
function WorkflowSteps({ job }: JobBodyProps) {
  if (!job.children.length) return null
  return (
    <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${Math.min(job.children.length, 6)}, minmax(0, 1fr))` }}>
      {job.children.slice(0, 6).map(step => {
        const fill = step.state === "done" ? 1 : step.state === "running" ? step.progress ?? 0.45 : 0
        return (
          <div key={step.id} data-step-state={step.state} className={`flex min-w-0 flex-col gap-[5px] text-[11px] ${step.state === "running" ? "text-text-primary" : "text-text-muted"}`}>
            <span aria-hidden="true" className="h-1 overflow-hidden rounded-sm" style={{ background: "rgb(from var(--contrast) r g b / 0.12)" }}>
              <span className="block h-full" style={{ width: `${fill * 100}%`, background: step.state === "done" ? "color-mix(in srgb, var(--job-kind) 70%, transparent)" : "var(--job-kind)" }} />
            </span>
            <span className="truncate">{step.title}</span>
          </div>
        )
      })}
    </div>
  )
}

/** What a finished card shrinks to once the reply shows its result; also a stopped job. */
export function JobChip({ job }: { job: ChatJob }) {
  const kind = KIND[job.kind]
  const stopped = job.state === "stopped"
  const detail = stopped
    ? "stopped"
    : [countWords(job) ?? (job.outputs.length === 1 ? `1 ${kind.noun[0]}` : null), job.durationMs !== null ? formatJobDuration(job.durationMs) : null]
        .filter(Boolean).join(" · ")
  const content = (
    <>
      <span aria-hidden="true" className="grid size-[18px] shrink-0 place-items-center rounded-full text-[11px]"
        style={{ color: "var(--job-kind)", background: "color-mix(in srgb, var(--job-kind) 17%, transparent)" }}>
        <i className={stopped ? "ph-bold ph-x" : kind.icon} />
      </span>
      <b className="truncate font-semibold text-text-primary">{job.title}</b>
      {detail && <span className="shrink-0">{detail}</span>}
      {!stopped && <i aria-hidden="true" className="ph-fill ph-check-circle shrink-0 text-[13px]" style={{ color: DONE_COLOR }} />}
      {job.href && <i aria-hidden="true" className="ph-bold ph-arrow-up-right shrink-0 text-xs opacity-70" />}
    </>
  )
  const className = `inline-flex max-w-full min-w-0 items-center gap-[7px] rounded-full border border-overlay-10 bg-overlay-4 hover:bg-overlay-6 py-1 pr-2.5 pl-1.5 text-xs whitespace-nowrap text-text-muted no-underline transition-colors hover:border-[color-mix(in_srgb,var(--job-kind)_45%,rgb(from_var(--contrast)_r_g_b_/_0.10))] ${stopped ? "opacity-75" : ""}`
  const style = { ["--job-kind" as string]: kind.color } as CSSProperties
  const data = { "data-slot": "job-chip", "data-job-id": job.id, "data-job-kind": job.kind, "data-job-state": job.state }
  return job.href
    ? <a href={job.href} data-job-link="" aria-label={`${job.title}, ${stopped ? "stopped" : "done"}`} className={className} style={style} {...data}>{content}</a>
    : <span className={className} style={style} {...data}>{content}</span>
}
