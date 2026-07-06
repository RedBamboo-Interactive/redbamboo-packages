import { useState, useRef, useEffect, useCallback } from "react"

const BAR_HEIGHTS = [6, 12, 8, 14, 10, 7, 11]

interface AudioPlayerWidgetProps {
  src: string
  avatarSrc?: string
}

export function AudioPlayerWidget({ src, avatarSrc }: AudioPlayerWidgetProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const rafRef = useRef<number>(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [progress, setProgress] = useState(0)

  const tick = useCallback(() => {
    const audio = audioRef.current
    if (audio && isFinite(audio.duration) && audio.duration > 0) {
      setProgress((audio.currentTime / audio.duration) * 100)
    }
    rafRef.current = requestAnimationFrame(tick)
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onPlay = () => { setIsPlaying(true); rafRef.current = requestAnimationFrame(tick) }
    const onPause = () => { setIsPlaying(false); cancelAnimationFrame(rafRef.current) }
    const onEnded = () => { setIsPlaying(false); cancelAnimationFrame(rafRef.current); setProgress(0) }
    audio.addEventListener("play", onPlay)
    audio.addEventListener("pause", onPause)
    audio.addEventListener("ended", onEnded)
    return () => {
      audio.removeEventListener("play", onPlay)
      audio.removeEventListener("pause", onPause)
      audio.removeEventListener("ended", onEnded)
      cancelAnimationFrame(rafRef.current)
    }
  }, [tick])

  const toggle = () => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) audio.pause()
    else audio.play().catch(() => {})
  }

  const ringBg = progress > 0
    ? `conic-gradient(from -90deg, var(--color-primary) ${progress}%, rgba(255,255,255,0.06) ${progress}%)`
    : "rgba(255,255,255,0.06)"

  return (
    <div className="inline-block my-2">
      <audio ref={audioRef} src={src} preload="metadata" />
      <button
        onClick={toggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="relative cursor-pointer group/player rounded-xl p-[3px] block"
        style={{ background: ringBg }}
      >
        <div className="relative w-[46px] h-[46px] rounded-[9px] overflow-hidden">
          {avatarSrc ? (
            <img src={avatarSrc} alt="" className="absolute inset-0 w-full h-full object-cover object-top" />
          ) : (
            <div className="absolute inset-0 bg-overlay-10 flex items-center justify-center">
              <i className="ph-fill ph-microphone text-base text-text-muted" />
            </div>
          )}
          <div className={`absolute inset-0 bg-gradient-to-t from-black/60 to-transparent flex items-end justify-center pb-1.5 transition-opacity duration-150 ${
            isPlaying ? "opacity-100" : "opacity-60 group-hover/player:opacity-85"
          }`}>
            {isPlaying ? (
              <div className="flex items-end gap-[2px]">
                {BAR_HEIGHTS.map((h, i) => (
                  <div
                    key={i}
                    className="w-[2px] rounded-full bg-white audio-wave"
                    style={{ height: `${h}px`, animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </div>
            ) : (
              <i className="ph-fill ph-play text-[11px] text-white ml-0.5" />
            )}
          </div>
        </div>
      </button>
    </div>
  )
}
