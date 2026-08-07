import { memo, useState, useRef, useEffect, useMemo, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { EntityCard, useEntityInteraction, useUiEnvironment } from "@redbamboo/ui"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { parseEntityEmbedParagraph, type EntityEmbedReference } from "../lib/entity-embed"
import { isImageUrl } from "../lib/event-image"
import { resolveChatMediaSrc } from "../lib/media-url"

// Module-level lightbox state shared across all StreamingText/MarkdownRenderer instances
const VIDEO_EXTENSIONS = /\.(webm|mp4|mov|avi|mkv|ogg)(\?.*)?$/i
function isVideoSrc(src?: string): boolean { return !!src && VIDEO_EXTENSIONS.test(src) }

let lightboxState: { src: string; alt: string; type: "image" | "video" } | null = null
const listeners = new Set<() => void>()
function setLightbox(s: typeof lightboxState) { lightboxState = s; listeners.forEach(fn => fn()) }
function subscribeLightbox(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
function getLightbox() { return lightboxState }

export function MediaLightbox() {
  const state = useSyncExternalStore(subscribeLightbox, getLightbox)
  const environment = useUiEnvironment()

  useEffect(() => {
    if (!state) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null) }
    environment.document.addEventListener("keydown", handler)
    return () => environment.document.removeEventListener("keydown", handler)
  }, [environment.document, state])

  if (!state) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
      onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null) }}
      role="dialog"
      aria-modal="true"
      aria-label={state.alt || (state.type === "video" ? "Video player" : "Image preview")}
    >
      <div className="max-w-4xl max-h-[90vh] overflow-auto animate-in fade-in zoom-in-98 duration-200" onClick={e => e.stopPropagation()}>
        {state.type === "video" ? (
          <video src={state.src} controls autoPlay className="max-w-full max-h-[85vh] rounded-xl" />
        ) : (
          <img src={state.src} alt={state.alt} className="max-w-full max-h-[85vh] rounded-xl object-contain" />
        )}
        {state.alt && <p className="text-sm text-text-muted text-center px-4 py-2">{state.alt}</p>}
      </div>
    </div>,
    environment.portalContainer,
  )
}

function ImageThumbnail({ src, alt, resolve }: { src?: string; alt?: string; resolve?: (s: string) => string | undefined }) {
  const resolved = resolveChatMediaSrc(src, resolve)

  return (
    <button
      onClick={() => setLightbox({ src: resolved || "", alt: alt || "", type: "image" })}
      className="inline-block rounded-lg overflow-hidden border border-overlay-10 hover:border-overlay-30 transition-colors cursor-pointer my-1"
    >
      <img src={resolved} alt={alt || ""} loading="lazy" className="w-20 h-20 object-cover" />
    </button>
  )
}

function MarkdownLink({
  href,
  children,
  resolve,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { resolve?: (s: string) => string | undefined }) {
  if (isImageUrl(href)) {
    const alt = typeof children === "string" ? children : ""
    return <ImageThumbnail src={href} alt={alt} resolve={resolve} />
  }

  return <a href={href} {...props}>{children}</a>
}

const VideoThumbnail = memo(function VideoThumbnail({ src, alt, resolve }: { src?: string; alt?: string; resolve?: (s: string) => string | undefined }) {
  const resolved = resolveChatMediaSrc(src, resolve)
  const [poster, setPoster] = useState<string | null>(null)
  const environment = useUiEnvironment()

  useEffect(() => {
    if (!resolved) return
    const video = environment.document.createElement("video")
    video.muted = true
    video.preload = "auto"
    let disposed = false

    const capture = () => {
      if (disposed) return
      try {
        const canvas = environment.document.createElement("canvas")
        canvas.width = 160
        canvas.height = 160
        const ctx = canvas.getContext("2d")
        if (ctx) {
          const vw = video.videoWidth || 160
          const vh = video.videoHeight || 160
          const scale = Math.max(160 / vw, 160 / vh)
          const dw = vw * scale
          const dh = vh * scale
          ctx.drawImage(video, (160 - dw) / 2, (160 - dh) / 2, dw, dh)
          setPoster(canvas.toDataURL("image/jpeg", 0.7))
        }
      } catch {}
      video.pause()
      video.removeAttribute("src")
      video.load()
    }

    video.addEventListener("seeked", capture, { once: true })
    video.addEventListener("loadeddata", () => { if (!disposed) video.currentTime = 0.1 }, { once: true })
    video.src = resolved

    return () => {
      disposed = true
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
  }, [environment.document, resolved])

  return (
    <button
      onClick={() => setLightbox({ src: resolved || "", alt: alt || "", type: "video" })}
      className="inline-block rounded-lg overflow-hidden border border-overlay-10 hover:border-overlay-30 transition-colors cursor-pointer my-1 relative"
    >
      {poster ? (
        <img src={poster} alt={alt || ""} className="w-20 h-20 object-cover" />
      ) : (
        <div className="w-20 h-20 bg-overlay-6" />
      )}
      <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="white" className="drop-shadow-md">
          <path d="M4 2.5v11l9-5.5z" />
        </svg>
      </div>
    </button>
  )
}, (prev, next) => prev.src === next.src && prev.alt === next.alt)

function EntityMarkdownCard({ reference }: { reference: EntityEmbedReference }) {
  const typeName = reference.typeSlug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())

  return (
    <div data-slot="entity-embed" className="my-2 max-w-lg font-sans">
      <EntityCard
        entity={{
          id: reference.id,
          typeSlug: reference.typeSlug,
          name: reference.name,
        }}
        visual={{ icon: "ph-bold ph-cube" }}
        subtitle={typeName}
        trailing={(
          <span className="font-mono text-[10px] text-text-disabled">
            {reference.id.slice(0, 8)}
          </span>
        )}
        variant="outlined"
        action={{
          kind: "inspect",
          href: reference.href,
          ariaLabel: `Inspect ${reference.name}`,
        }}
      />
    </div>
  )
}

function useMarkdownComponents(
  resolveImageSrc: ((src: string) => string | undefined) | undefined,
  currentOrigin: string,
) {
  const entityEmbedsEnabled = useEntityInteraction() !== null
  const resolveRef = useRef(resolveImageSrc)
  resolveRef.current = resolveImageSrc

  return useMemo(() => ({
    img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => {
      const s = src?.toString()
      if (isVideoSrc(s)) return <VideoThumbnail src={s} alt={alt?.toString()} resolve={resolveRef.current} />
      return <ImageThumbnail src={s} alt={alt?.toString()} resolve={resolveRef.current} />
    },
    a: ({ href, children, node: _node, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { node?: unknown }) => (
      <MarkdownLink href={href} resolve={resolveRef.current} {...props}>{children}</MarkdownLink>
    ),
    p: ({ node, children, ...props }: React.HTMLAttributes<HTMLParagraphElement> & { node?: unknown }) => {
      const reference = entityEmbedsEnabled
        ? parseEntityEmbedParagraph(node, currentOrigin)
        : null
      return reference
        ? <EntityMarkdownCard reference={reference} />
        : <p {...props}>{children}</p>
    },
  }), [currentOrigin, entityEmbedsEnabled])
}

const CHARS_PER_FRAME = 3

export function StreamingText({
  content,
  isLive,
  resolveImageSrc,
}: {
  content: string
  isLive: boolean
  resolveImageSrc?: (src: string) => string | undefined
}) {
  const environment = useUiEnvironment()
  const revealedRef = useRef(isLive ? 0 : content.length)
  const targetRef = useRef(content.length)
  const rafRef = useRef<number>(0)
  const [revealed, setRevealed] = useState(revealedRef.current)

  targetRef.current = content.length

  useEffect(() => {
    if (!isLive) {
      revealedRef.current = content.length
      setRevealed(content.length)
      return
    }
    const tick = () => {
      if (revealedRef.current < targetRef.current) {
        revealedRef.current = Math.min(revealedRef.current + CHARS_PER_FRAME, targetRef.current)
        setRevealed(revealedRef.current)
      }
      rafRef.current = environment.window.requestAnimationFrame(tick)
    }
    rafRef.current = environment.window.requestAnimationFrame(tick)
    return () => environment.window.cancelAnimationFrame(rafRef.current)
  }, [environment.window, isLive, content.length])

  const mdComponents = useMarkdownComponents(resolveImageSrc, environment.window.location.origin)

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={mdComponents}
      urlTransform={(u: string) => u}
    >
      {content.slice(0, revealed)}
    </Markdown>
  )
}

export function MarkdownRenderer({
  content,
  resolveImageSrc,
}: {
  content: string
  resolveImageSrc?: (src: string) => string | undefined
}) {
  const environment = useUiEnvironment()
  const mdComponents = useMarkdownComponents(resolveImageSrc, environment.window.location.origin)

  return (
    <Markdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={mdComponents}
      urlTransform={(u: string) => u}
    >
      {content}
    </Markdown>
  )
}
