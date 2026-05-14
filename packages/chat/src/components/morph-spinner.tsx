import { useState, useEffect, useRef } from "react"

const SHAPES = ["triangle", "square", "pentagon", "hexagon", "diamond", "star", "circle"] as const
type Shape = (typeof SHAPES)[number]

const NUM_PTS = 18
const R = 46

function ngonR(n: number, startDeg: number, angle: number): number {
  const start = (startDeg * Math.PI) / 180
  const sector = (2 * Math.PI) / n
  const half = sector / 2
  const adj = (((angle - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  return (R * Math.cos(half)) / Math.cos((adj % sector) - half)
}

function starR(angle: number): number {
  const innerR = R * 0.55
  const sector = Math.PI / 5
  const adj = ((angle % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const idx = Math.floor(adj / sector)
  const r1 = idx % 2 === 0 ? R : innerR
  const r2 = idx % 2 === 0 ? innerR : R
  const a1 = idx * sector
  const a2 = (idx + 1) * sector
  const x1 = r1 * Math.sin(a1), y1 = -r1 * Math.cos(a1)
  const x2 = r2 * Math.sin(a2), y2 = -r2 * Math.cos(a2)
  const dx = Math.sin(angle), dy = -Math.cos(angle)
  const denom = (x2 - x1) * dy - (y2 - y1) * dx
  if (Math.abs(denom) < 1e-10) return (r1 + r2) / 2
  const t = (y1 * dx - x1 * dy) / denom
  const ix = x1 + t * (x2 - x1)
  const iy = y1 + t * (y2 - y1)
  return Math.sqrt(ix * ix + iy * iy)
}

function buildClipPath(radiusFn: (a: number) => number): string {
  const pts = Array.from({ length: NUM_PTS }, (_, i) => {
    const a = (i * 2 * Math.PI) / NUM_PTS
    const r = radiusFn(a)
    return `${Math.round(50 + r * Math.sin(a))}% ${Math.round(50 - r * Math.cos(a))}%`
  })
  return `polygon(${pts.join(", ")})`
}

const CLIP_PATHS: Record<Shape, string> = {
  triangle: buildClipPath(a => ngonR(3, 0, a)),
  square:   buildClipPath(a => ngonR(4, 45, a)),
  pentagon: buildClipPath(a => ngonR(5, 0, a)),
  hexagon:  buildClipPath(a => ngonR(6, 0, a)),
  diamond:  buildClipPath(a => ngonR(4, 0, a)),
  star:     buildClipPath(starR),
  circle:   buildClipPath(() => R),
}

export function MorphSpinner({ color, paused }: { color: string; paused?: boolean }) {
  const [shape, setShape] = useState<Shape>("square")
  const [bouncing, setBouncing] = useState(false)
  const prevColor = useRef(color)

  useEffect(() => {
    if (color !== prevColor.current) {
      prevColor.current = color
      setShape(prev => {
        const others = SHAPES.filter(s => s !== prev)
        return others[Math.floor(Math.random() * others.length)]
      })
      setBouncing(true)
    }
  }, [color])

  return (
    <span
      className={`morph-spinner-wrap${bouncing ? " morph-bouncing" : ""}`}
      onAnimationEnd={() => setBouncing(false)}
    >
      <span
        className="morph-spinner"
        style={{
          "--morph-color": color,
          clipPath: CLIP_PATHS[shape],
          ...(paused ? { animationPlayState: "paused" } : undefined),
        } as React.CSSProperties}
      />
    </span>
  )
}
