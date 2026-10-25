import { useEffect, useState, type MouseEvent } from "react"
import { createPortal } from "react-dom"
import { useUiEnvironment } from "@redbamboo/ui"
import type { MessagePart } from "../types"
import { imageReadPath } from "../lib/image-read"
import { resolveChatMediaSrc } from "../lib/media-url"

const EMBED_THUMBNAIL_SIZE = 80
const VIEWPORT_GUTTER = 8

function previewCenter(value: number, viewportSize: number): number {
  const half = EMBED_THUMBNAIL_SIZE / 2
  const minimum = half + VIEWPORT_GUTTER
  const maximum = Math.max(minimum, viewportSize - half - VIEWPORT_GUTTER)
  return Math.min(Math.max(value, minimum), maximum)
}

export function ImageReadThumbnail({ part, resolveImageSrc }: {
  part: MessagePart
  resolveImageSrc?: (src: string) => string | undefined
}) {
  const environment = useUiEnvironment()
  const path = imageReadPath(part)
  const src = resolveChatMediaSrc(path, resolveImageSrc)
  const [loadedSrc, setLoadedSrc] = useState<string>()
  const [preview, setPreview] = useState<{ left: number; top: number }>()
  const [previewExpanded, setPreviewExpanded] = useState(false)
  useEffect(() => {
    if (!preview) {
      setPreviewExpanded(false)
      return
    }
    const frame = environment.window.requestAnimationFrame(() => setPreviewExpanded(true))
    return () => environment.window.cancelAnimationFrame(frame)
  }, [environment.window, preview])
  if (!src) return null

  const loaded = loadedSrc === src
  const showPreview = (event: MouseEvent<HTMLSpanElement>) => {
    if (!loaded) return
    const bounds = event.currentTarget.getBoundingClientRect()
    setPreview({
      left: previewCenter(bounds.left + bounds.width / 2, environment.window.innerWidth),
      top: previewCenter(bounds.top + bounds.height / 2, environment.window.innerHeight),
    })
  }
  return (
    <>
      <img
        key={src}
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className={`pointer-events-none absolute inset-0 size-full rounded-[2px] object-cover transition-opacity duration-100 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoadedSrc(src)}
        onError={() => {
          setLoadedSrc(undefined)
          setPreview(undefined)
        }}
      />
      <span
        aria-hidden="true"
        data-image-thumbnail-loaded={loaded || undefined}
        className={`pointer-events-none absolute inset-0 rounded-[2px] ring-1 ring-inset ring-white/45 transition-opacity duration-100 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
      {loaded && (
        <span
          aria-hidden="true"
          className="absolute inset-0 cursor-pointer"
          onMouseEnter={showPreview}
          onMouseLeave={() => setPreview(undefined)}
        />
      )}
      {preview && createPortal(
        <span
          aria-hidden="true"
          data-slot="image-read-hover-preview"
          className={`pointer-events-none fixed z-[80] size-20 origin-center -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-white/40 bg-black/95 shadow-[0_14px_34px_rgb(0_0_0/0.52),0_2px_8px_rgb(0_0_0/0.42)] transition-[transform,opacity,border-radius] duration-200 ease-out [@media(hover:none)]:hidden [@media(pointer:coarse)]:hidden ${previewExpanded ? "scale-100 rounded-lg opacity-100" : "scale-[0.125] rounded-[2px] opacity-20"}`}
          style={{ left: preview.left, top: preview.top }}
        >
          <img src={src} alt="" draggable={false} className="size-full object-cover" />
        </span>,
        environment.portalContainer,
      )}
    </>
  )
}
