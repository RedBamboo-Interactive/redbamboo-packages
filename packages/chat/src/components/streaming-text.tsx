import { useState, useRef, useEffect } from "react"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
function ImageThumbnail({ src, alt, resolve }: { src?: string; alt?: string; resolve?: (s: string) => string | undefined }) {
  const [open, setOpen] = useState(false)
  const resolved = src && resolve ? (resolve(src) ?? src) : src

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-block rounded-lg overflow-hidden border border-white/10 hover:border-white/30 transition-colors cursor-pointer my-1"
      >
        <img src={resolved} alt={alt || ""} loading="lazy" className="w-20 h-20 object-cover" />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setOpen(false)}>
          <div className="max-w-lg max-h-[80vh] overflow-auto" onClick={e => e.stopPropagation()}>
            <img src={resolved} alt={alt || ""} className="max-w-full max-h-[80vh] rounded-xl object-contain" />
            {alt && <p className="text-sm text-text-muted text-center px-4 py-2">{alt}</p>}
          </div>
        </div>
      )}
    </>
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
    img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <ImageThumbnail src={src?.toString()} alt={alt?.toString()} resolve={resolveImageSrc} />
    ),
  }

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
  const mdComponents = {
    img: ({ src, alt }: React.ImgHTMLAttributes<HTMLImageElement>) => (
      <ImageThumbnail src={src?.toString()} alt={alt?.toString()} resolve={resolveImageSrc} />
    ),
  }

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
