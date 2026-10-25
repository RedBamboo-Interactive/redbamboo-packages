import { useState } from "react"
import type { MessagePart } from "../types"
import { imageReadPath } from "../lib/image-read"
import { resolveChatMediaSrc } from "../lib/media-url"

export function ImageReadThumbnail({ part, resolveImageSrc }: {
  part: MessagePart
  resolveImageSrc?: (src: string) => string | undefined
}) {
  const path = imageReadPath(part)
  const src = resolveChatMediaSrc(path, resolveImageSrc)
  const [loadedSrc, setLoadedSrc] = useState<string>()
  if (!src) return null

  const loaded = loadedSrc === src
  return (
    <>
      <img
        key={src}
        src={src}
        alt=""
        aria-hidden="true"
        loading="lazy"
        decoding="async"
        className={`pointer-events-none absolute inset-0 size-full object-cover transition-opacity duration-100 ${loaded ? "opacity-100" : "opacity-0"}`}
        onLoad={() => setLoadedSrc(src)}
        onError={() => setLoadedSrc(undefined)}
      />
      <span
        aria-hidden="true"
        className={`pointer-events-none absolute inset-0 rounded-[2px] ring-1 ring-inset ring-white/45 transition-opacity duration-100 ${loaded ? "opacity-100" : "opacity-0"}`}
      />
    </>
  )
}
