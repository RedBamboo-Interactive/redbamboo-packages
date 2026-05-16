import { useState, useEffect, useRef } from "react"

const HEX = "0123456789abcdef"
const LEN = 7

function randomChar() {
  return HEX[Math.floor(Math.random() * 16)]!
}

export function GhostHash() {
  const [chars, setChars] = useState(() =>
    Array.from({ length: LEN }, randomChar),
  )
  const idx = useRef(0)

  useEffect(() => {
    const id = setInterval(() => {
      const i = idx.current
      idx.current = (i + 1) % LEN
      setChars((prev) => {
        const next = [...prev]
        next[i] = randomChar()
        return next
      })
    }, 30)
    return () => clearInterval(id)
  }, [])

  return (
    <span className="font-mono text-[11px] text-text-disabled opacity-40">
      {chars.join("")}
    </span>
  )
}
