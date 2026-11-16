import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import {
  capabilityLabel, formatJobDuration, isActiveJob, jobElapsed, jobProgress, jobStageWords,
  type ChatJob, type ChatJobKind,
} from "../lib/chat-jobs"
import { openMediaLightbox } from "./streaming-text"

/**
 * One card per job, in the agent message that launched it, never larger than
 * the chat's own embeds: one 80 px square (the embed's size) and a three-line
 * caption beside it (what, where, status). Every kind has the same card; only
 * the square changes. Nothing ever grows below the caption, so a card's size
 * is fixed from its first frame and a job progressing never moves the thread.
 * A finished job the reply already shows folds into the one-line chip.
 *
 * Colour lives only in the square's icon, the ring and the 2 px progress edge;
 * only "needs you" and "failed" tint the card. A percentage only when the job
 * reports real progress; otherwise a spinner, the elapsed time and the stage in
 * words. The title is the card's link to the job; the square opens images and
 * video in the chat's lightbox, like an embed. No live region.
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

export interface JobBodyProps {
  job: ChatJob
  resolveImageSrc?: (src: string) => string | undefined
}
export type JobBodyRenderer = (props: JobBodyProps) => ReactNode

/**
 * What a card's square shows, by kind. A new kind is one entry; a kind without
 * one shows its icon. The square is always 78 x 78 inside the card's border.
 */
export const JOB_BODY_RENDERERS: Partial<Record<ChatJobKind, JobBodyRenderer>> = {
  image: props => <ImageSquare {...props} />,
  video: props => <VideoSquare {...props} />,
  audio: props => <AudioSquare {...props} />,
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
  const color = job.state === "failed" ? FAILED_COLOR : KIND[job.kind].color
  const progress = jobProgress(job)
  const cardStyle: CSSProperties = {
    ["--job-kind" as string]: color,
    ...(job.state === "failed" ? { borderColor: `color-mix(in srgb, ${FAILED_COLOR} 45%, ${OVERLAY(0.1)})` } : {}),
    ...(job.state === "needs-you" ? {
      borderColor: `color-mix(in srgb, ${NEEDS_COLOR} 55%, ${OVERLAY(0.1)})`,
      background: `color-mix(in srgb, ${NEEDS_COLOR} 8%, ${OVERLAY(0.04)})`,
    } : {}),
  }
  return (
    <div
      data-slot="job-card"
      data-job-id={job.id}
      data-job-kind={job.kind}
      data-job-state={job.state}
      className="group/job relative inline-flex h-20 w-[340px] max-w-full shrink-0 overflow-hidden rounded-lg border border-overlay-10 bg-overlay-4 text-[13px] leading-[1.4] transition-colors duration-200 hover:bg-overlay-6 hover:border-[color-mix(in_srgb,var(--job-kind)_45%,rgb(from_var(--contrast)_r_g_b_/_0.10))] focus-within:border-[color-mix(in_srgb,var(--job-kind)_45%,rgb(from_var(--contrast)_r_g_b_/_0.10))]"
      style={cardStyle}
    >
      <JobSquare job={job} progress={progress} resolveImageSrc={resolveImageSrc} />
      <div className="flex min-w-0 flex-1 flex-col justify-center gap-px pr-7 pl-[11px]">
        <JobTitleLink job={job} />
        <JobSubtitle job={job} progress={progress} />
        <div className="relative z-10 mt-[3px] inline-flex min-w-0 items-center gap-1.5 text-[11.5px] whitespace-nowrap tabular-nums text-text-muted">
          <JobStatus job={job} progress={progress} />
          {onStop && isActiveJob(job) && <StopButton job={job} onStop={onStop} />}
        </div>
      </div>
      {job.href && <i aria-hidden="true" className="ph-bold ph-arrow-up-right pointer-events-none absolute top-[7px] right-2 text-xs text-text-muted opacity-0 transition-opacity duration-200 group-hover/job:opacity-90 group-focus-within/job:opacity-90 [@media(hover:none)]:opacity-90" />}
    </div>
  )
}

/** The cards a turn launched, after its frieze: side by side, wrapping, like embeds. */
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
    <div data-slot="job-cards" className={`flex w-full min-w-0 flex-wrap items-start gap-2 ${className ?? ""}`}>
      {jobs.map(job => (
        <JobCard key={job.id} job={job} collapsed={collapsed?.has(job.id)} onStop={onStop} resolveImageSrc={resolveImageSrc} />
      ))}
    </div>
  )
}

/** The 78 x 78 square: the kind's media when it has a renderer, else its icon; the progress edge on top. */
function JobSquare({ job, progress, resolveImageSrc }: { job: ChatJob; progress: number | null; resolveImageSrc?: (src: string) => string | undefined }) {
  const content = job.state === "failed"
    ? <SquareIcon icon="ph-bold ph-warning" tinted />
    : JOB_BODY_RENDERERS[job.kind]?.({ job, resolveImageSrc }) ?? <SquareIcon icon={KIND[job.kind].icon} tinted={job.state !== "queued"} />
  return (
    <div data-slot="job-square" className="relative size-[78px] shrink-0 overflow-hidden bg-overlay-6"
      style={job.state === "failed" ? { background: `color-mix(in srgb, ${FAILED_COLOR} 12%, transparent)` } : undefined}>
      {content}
      {job.state === "running" && (job.kind === "workflow" && job.children.length ? <StepEdge job={job} /> : <ProgressEdge progress={progress} />)}
    </div>
  )
}

function SquareIcon({ icon, tinted }: { icon: string; tinted: boolean }) {
  return (
    <span aria-hidden="true" className="absolute inset-0 grid place-items-center">
      <span className="grid size-[34px] place-items-center rounded-[9px] text-[17px]"
        style={tinted
          ? { color: "var(--job-kind)", background: "color-mix(in srgb, var(--job-kind) 17%, transparent)" }
          : { color: "var(--color-text-muted)" }}>
        <i className={icon} />
      </span>
    </span>
  )
}

function JobTitleLink({ job }: { job: ChatJob }) {
  const className = "truncate text-[13px] font-semibold text-text-primary no-underline outline-none"
  if (!job.href) return <span className={className}>{job.title}</span>
  // The title is the card's link; its hit area is stretched over the caption and the card's free space.
  return (
    <a
      href={job.href}
      data-job-link=""
      title={job.title}
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

/** Line two: where it runs and what it's doing, or for a failure, what went wrong. */
function JobSubtitle({ job, progress }: { job: ChatJob; progress: number | null }) {
  if (job.state === "failed" && job.errorMessage) {
    return <span title={job.errorMessage} className="truncate text-[11.5px]" style={{ color: FAILED_COLOR }}>{job.errorMessage}</span>
  }
  const parts: string[] = [job.provider ?? capabilityLabel(job.capability)]
  if (job.state === "queued" || job.state === "needs-you" || (job.state === "running" && progress === null)) {
    const words = jobStageWords(job)
    if (words) parts.push(words)
  }
  const count = countWords(job)
  if (count) parts.push(count)
  const text = parts.join(" · ")
  return <span title={text} className="truncate text-[11.5px] text-text-muted">{text}</span>
}

/** Line three: the state in words, with the ring. */
function JobStatus({ job, progress }: { job: ChatJob; progress: number | null }) {
  const now = useNow(job.state === "running" && progress === null)
  switch (job.state) {
    case "queued":
      return <><span aria-hidden="true" className="box-border size-[13px] shrink-0 rounded-full border-[1.5px] border-dashed border-text-muted/75" />Queued</>
    case "running": {
      if (progress !== null) {
        const percent = Math.round(progress * 100)
        return (
          <span role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={`${job.title} progress`}
            className="inline-flex items-center gap-1.5">
            <Ring progress={progress} />{percent}%
          </span>
        )
      }
      const elapsed = jobElapsed(job, now)
      return <><Ring spinning />{elapsed !== null ? formatJobDuration(elapsed) : "Running"}</>
    }
    case "done":
      return (
        <span className="inline-flex items-center gap-1" style={{ color: DONE_COLOR }}>
          <i aria-hidden="true" className="ph-bold ph-check text-xs" />Done
          {job.durationMs !== null && <span className="text-text-muted">· {formatJobDuration(job.durationMs)}</span>}
        </span>
      )
    case "failed": {
      const at = progress !== null ? ` at ${Math.round(progress * 100)}%` : ""
      return <span style={{ color: FAILED_COLOR }}>Failed{at}</span>
    }
    case "needs-you":
      return (
        <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: NEEDS_COLOR }}>
          <span aria-hidden="true" className="job-pulse size-1.5 rounded-full bg-current" />Needs you
        </span>
      )
    default:
      return null
  }
}

/** Determinate ring, or a spinning arc; colour from the card's kind. */
function Ring({ progress = 0.28, spinning = false }: { progress?: number; spinning?: boolean }) {
  const mask = "radial-gradient(circle, transparent 4px, #000 4.6px)"
  return (
    <span
      aria-hidden="true"
      className={`size-[13px] shrink-0 rounded-full ${spinning ? "animate-spin motion-reduce:animate-none" : ""}`}
      style={{
        background: `conic-gradient(var(--job-kind) ${progress * 100}%, color-mix(in srgb, var(--job-kind) 22%, transparent) 0)`,
        WebkitMask: mask,
        mask,
      }}
    />
  )
}

/** Stop, in words, on hover (always on touch). Above the card's link. */
function StopButton({ job, onStop }: { job: ChatJob; onStop: (job: ChatJob) => Promise<void> | void }) {
  const [stopping, setStopping] = useState(false)
  return (
    <button
      type="button"
      data-job-stop=""
      aria-label={`Stop ${job.title}`}
      disabled={stopping}
      onClick={async () => {
        setStopping(true)
        try { await onStop(job) } catch { /* The card keeps its state; the next read says what happened. */ }
        finally { setStopping(false) }
      }}
      className="rounded px-1 text-[11.5px] text-text-muted underline-offset-2 opacity-0 transition-opacity duration-200 hover:text-text-primary hover:underline focus-visible:opacity-100 disabled:opacity-40 group-hover/job:opacity-100 [@media(hover:none)]:opacity-100"
    >
      Stop
    </button>
  )
}

/** The only progress bar: 2 px along the square's bottom edge. */
function ProgressEdge({ progress }: { progress: number | null }) {
  return (
    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 z-10 h-[2px] overflow-hidden" style={{ background: "color-mix(in srgb, var(--job-kind) 14%, transparent)" }}>
      <span
        className={`block h-full ${progress === null ? "job-hairline-indeterminate" : "transition-[width] duration-500 ease-out"}`}
        style={{ background: "var(--job-kind)", ...(progress === null ? {} : { width: `${progress * 100}%` }) }}
      />
    </span>
  )
}

/** A workflow's steps as the segmented edge: done, running (partly filled), waiting. */
function StepEdge({ job }: { job: ChatJob }) {
  const steps = job.children.slice(0, 8)
  return (
    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 z-10 grid h-[2px] gap-0.5" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
      {steps.map(step => {
        const fill = step.state === "done" ? 1 : step.state === "running" ? step.progress ?? 0.45 : 0
        return (
          <span key={step.id} data-step-state={step.state} className="block h-full overflow-hidden" style={{ background: "color-mix(in srgb, var(--job-kind) 14%, transparent)" }}>
            <span className="block h-full" style={{ width: `${fill * 100}%`, background: "var(--job-kind)" }} />
          </span>
        )
      })}
    </span>
  )
}

function outputUrl(job: ChatJob, type: string): string | null {
  return job.outputs.find(output => (output.contentType ?? "").startsWith(`${type}/`))?.url ?? job.outputs[0]?.url ?? null
}

/**
 * One image fills the square; a batch is a 2 x 2 mosaic with "+N" past four.
 * Each tile shimmers until its picture arrives, then develops out of a blur.
 */
function ImageSquare({ job, resolveImageSrc }: JobBodyProps) {
  const tiles: { key: string; src: string | null }[] = job.children.length
    ? job.children.map(child => ({ key: child.id, src: child.state === "done" ? outputUrl(child, "image") : null }))
    : job.state === "done" && job.outputs.length
      ? job.outputs.map((output, index) => ({ key: `${job.id}:${index}`, src: output.url }))
      : [{ key: job.id, src: null }]
  if (tiles.length === 1) {
    const only = tiles[0]
    return <ImageTile src={only.src} resolveImageSrc={resolveImageSrc} idleIcon={job.state === "queued"} fill />
  }
  const shown = tiles.slice(0, 4)
  return (
    <div data-slot="job-tiles" className="grid size-full grid-cols-2 grid-rows-2 gap-0.5">
      {shown.map(({ key, src }) => <ImageTile key={key} src={src} resolveImageSrc={resolveImageSrc} />)}
      {tiles.length > 4 && (
        <span className="absolute right-1 bottom-1 z-10 rounded-[5px] bg-black/55 px-[5px] text-[10px] font-semibold text-white">+{tiles.length - 4}</span>
      )}
    </div>
  )
}

function ImageTile({ src, resolveImageSrc, idleIcon = false, fill = false }: {
  src: string | null
  resolveImageSrc?: (src: string) => string | undefined
  idleIcon?: boolean
  fill?: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const resolved = src ? resolveImageSrc?.(src) ?? src : null
  const showable = !!resolved && !failed
  const open = showable && loaded
  // One element from the first frame to the last, so the picture never remounts; it opens like an embed once it has arrived.
  return (
    <button
      type="button"
      data-slot="job-tile"
      data-developed={loaded || undefined}
      aria-label={open ? "Open image" : undefined}
      aria-hidden={open ? undefined : true}
      tabIndex={open ? 0 : -1}
      disabled={!open}
      onClick={() => { if (open && resolved) openMediaLightbox(resolved, "image") }}
      className={`overflow-hidden bg-overlay-6 p-0 ${fill ? "absolute inset-0" : "relative size-full"} ${open ? "z-10 cursor-zoom-in" : "cursor-default"}`}
    >
      {!open && <span aria-hidden="true" className="job-shimmer absolute inset-0" />}
      {idleIcon && !showable && <SquareIcon icon={KIND.image.icon} tinted={false} />}
      {showable && (
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
    </button>
  )
}

/** The first frame as a poster with a play glyph; a finished video opens in the lightbox. */
function VideoSquare({ job }: JobBodyProps) {
  const src = job.state === "done" ? outputUrl(job, "video") : null
  if (!src) {
    return (
      <>
        <span aria-hidden="true" className="job-shimmer absolute inset-0" />
        <SquareIcon icon={KIND.video.icon} tinted={job.state !== "queued"} />
      </>
    )
  }
  return (
    <button type="button" aria-label="Play video" onClick={() => openMediaLightbox(src, "video")}
      className="absolute inset-0 z-10 block cursor-pointer p-0">
      <video src={src} muted playsInline preload="metadata" className="block size-full object-cover" />
      <span aria-hidden="true" className="absolute inset-0 grid place-items-center bg-black/20 text-white">
        <i className="ph-fill ph-play text-lg drop-shadow-md" />
      </span>
    </button>
  )
}

/** The kind's icon while it composes; a play button that plays in place once it's done. */
function AudioSquare({ job }: JobBodyProps) {
  const src = job.state === "done" ? outputUrl(job, "audio") : null
  if (!src) return <SquareIcon icon={KIND.audio.icon} tinted={job.state !== "queued"} />
  return <SquarePlayer src={src} title={job.title} />
}

function SquarePlayer({ src, title }: { src: string; title: string }) {
  const audio = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [position, setPosition] = useState(0)
  const [duration, setDuration] = useState(0)
  const played = useMemo(() => (duration > 0 ? position / duration : 0), [position, duration])
  return (
    <div className="absolute inset-0 z-10" data-context-media="audio" data-context-media-src={src}>
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
        title={duration > 0 ? `${formatJobDuration(position * 1000)} / ${formatJobDuration(duration * 1000)}` : undefined}
        onClick={() => {
          const element = audio.current
          if (!element) return
          if (element.paused) void element.play().catch(() => {})
          else element.pause()
        }}
        className="grid size-full place-items-center text-white"
        style={{ background: "color-mix(in srgb, var(--job-kind) 32%, transparent)" }}
      >
        <i aria-hidden="true" className={`ph-fill ${playing ? "ph-pause" : "ph-play"} text-lg drop-shadow-md`} />
      </button>
      {(playing || position > 0) && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[2px]" style={{ background: "color-mix(in srgb, var(--job-kind) 14%, transparent)" }}>
          <span className="block h-full" style={{ width: `${played * 100}%`, background: "var(--job-kind)" }} />
        </span>
      )}
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
