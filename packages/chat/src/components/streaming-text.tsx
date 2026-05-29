import { useState, useRef, useEffect, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import { rehypeTwemoji } from "../lib/rehype-twemoji"

// Module-level lightbox state — survives component remounts from markdown re-renders
let lightboxState: { src: string; alt: string } | null = null
const listeners = new Set<() => void>()
function setLightbox(s: typeof lightboxState) { lightboxState = s; listeners.forEach(fn => fn()) }
function subscribeLightbox(cb: () => void) { listeners.add(cb); return () => { listeners.delete(cb) } }
function getLightbox() { return lightboxState }

let lightboxMounted = 0
function ImageLightbox() {
  const state = useSyncExternalStore(subscribeLightbox, getLightbox)
  const isFirst = useRef(false)

  useEffect(() => {
    if (lightboxMounted === 0) isFirst.current = true
    lightboxMounted++
    return () => { lightboxMounted--; isFirst.current = false }
  }, [])

  useEffect(() => {
    if (!state) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(null) }
    document.addEventListener("keydown", handler)
    return () => document.removeEventListener("keydown", handler)
  }, [state])

  if (!state || !isFirst.current) return null

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-in fade-in duration-300"
      onClick={(e) => { if (e.target === e.currentTarget) setLightbox(null) }}
      role="dialog"
      aria-modal="true"
      aria-label={state.alt || "Image preview"}
    >
      <div className="max-w-4xl max-h-[90vh] overflow-auto animate-in fade-in zoom-in-98 duration-200" onClick={e => e.stopPropagation()}>
        <img src={state.src} alt={state.alt} className="max-w-full max-h-[85vh] rounded-xl object-contain" />
        {state.alt && <p className="text-sm text-text-muted text-center px-4 py-2">{state.alt}</p>}
      </div>
    </div>,
    document.body,
  )
}

function ImageThumbnail({ src, alt, resolve }: { src?: string; alt?: string; resolve?: (s: string) => string | undefined }) {
  const resolved = src && resolve ? (resolve(src) ?? src) : src

  return (
    <button
      onClick={() => setLightbox({ src: resolved || "", alt: alt || "" })}
      className="inline-block rounded-lg overflow-hidden border border-overlay-10 hover:border-overlay-30 transition-colors cursor-pointer my-1"
    >
      <img src={resolved} alt={alt || ""} loading="lazy" className="w-20 h-20 object-cover" />
    </button>
  )
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
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [isLive, content.length])

  const mdComponents = {
    img: ({ src, alt, className }: React.ImgHTMLAttributes<HTMLImageElement>) => {
      if (className?.toString().includes("twemoji")) {
        return <img src={src} alt={alt} className="twemoji" draggable={false} style={{ display: "inline", height: "1.2em", width: "1.2em", verticalAlign: "-0.2em", margin: "0 0.05em", filter: "invert(1) drop-shadow(0 0 0.15px white) drop-shadow(0 0 0.15px white) drop-shadow(0 0 0.15px white)", opacity: 0.8 }} />
      }
      return <ImageThumbnail src={src?.toString()} alt={alt?.toString()} resolve={resolveImageSrc} />
    },
  }

  return (
    <>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeTwemoji]}
        components={mdComponents}
        urlTransform={(u: string) => u}
      >
        {content.slice(0, revealed)}
      </Markdown>
      <ImageLightbox />
    </>
  )
}

export function MarkdownRenderer({
  content,
  resolveImageSrc,
}: {
  content: string
  resolveImageSrc?: (src: string) => string | undefined
}) {
  const mdComponents = {
    img: ({ src, alt, className }: React.ImgHTMLAttributes<HTMLImageElement>) => {
      if (className?.toString().includes("twemoji")) {
        return <img src={src} alt={alt} className="twemoji" draggable={false} style={{ display: "inline", height: "1.2em", width: "1.2em", verticalAlign: "-0.2em", margin: "0 0.05em", filter: "invert(1) drop-shadow(0 0 0.15px white) drop-shadow(0 0 0.15px white) drop-shadow(0 0 0.15px white)", opacity: 0.8 }} />
      }
      return <ImageThumbnail src={src?.toString()} alt={alt?.toString()} resolve={resolveImageSrc} />
    },
  }

  return (
    <>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight, rehypeTwemoji]}
        components={mdComponents}
        urlTransform={(u: string) => u}
      >
        {content}
      </Markdown>
      <ImageLightbox />
    </>
  )
}
