import { useState, type MouseEvent } from "react"
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
          className="image-read-hover-preview"
          style={{ left: preview.left, top: preview.top }}
        >
          <img src={src} alt="" draggable={false} />
        </span>,
        environment.portalContainer,
      )}
    </>
  )
}
