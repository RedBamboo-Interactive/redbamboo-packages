import { useEffect, useState } from "react"
import { useUiEnvironment } from "@redbamboo/ui"

/**
 * First-frame poster for a video URL, captured off-screen into a small JPEG
 * data URL. Shared by the chat Markdown video thumbnail and the Artifacts
 * panel. `enabled` lets a caller defer the download (for example until a tile
 * scrolls into view). Returns null until a frame is captured or when capture
 * fails (cross-origin video without CORS, unsupported codec).
 */
export function useVideoPoster(src: string | undefined, size = 160, enabled = true): string | null {
  const [poster, setPoster] = useState<string | null>(null)
  const environment = useUiEnvironment()

  useEffect(() => {
    setPoster(null)
    if (!src || !enabled) return
    const video = environment.document.createElement("video")
    video.muted = true
    video.preload = "auto"
    let disposed = false

    const capture = () => {
      if (disposed) return
      try {
        const canvas = environment.document.createElement("canvas")
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext("2d")
        if (ctx) {
          const vw = video.videoWidth || size
          const vh = video.videoHeight || size
          const scale = Math.max(size / vw, size / vh)
          const dw = vw * scale
          const dh = vh * scale
          ctx.drawImage(video, (size - dw) / 2, (size - dh) / 2, dw, dh)
          setPoster(canvas.toDataURL("image/jpeg", 0.7))
        }
      } catch {}
      video.pause()
      video.removeAttribute("src")
      video.load()
    }

    video.addEventListener("seeked", capture, { once: true })
    video.addEventListener("loadeddata", () => { if (!disposed) video.currentTime = 0.1 }, { once: true })
    video.src = src

    return () => {
      disposed = true
      video.pause()
      video.removeAttribute("src")
      video.load()
    }
  }, [enabled, environment.document, size, src])

  return poster
}
