import { useState } from "react"
import type { ContextIndicatorProps } from "../types"
import { SessionStatsModal, getContextPercent } from "./session-stats-modal"

const SIZE = 28
const STROKE = 3
const RADIUS = (SIZE - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

function ringColor(pct: number): string {
  if (pct < 60) return "var(--color-accent-teal)"
  if (pct < 80) return "var(--color-accent-gold)"
  return "var(--color-accent-red)"
}

export function ContextIndicator({ stats, messages, modelOptions, effortOptions, qualityTierOptions, onConfigChange }: ContextIndicatorProps) {
  const [open, setOpen] = useState(false)
  const pct = stats ? getContextPercent(stats) : null
  const offset = pct != null ? CIRCUMFERENCE * (1 - pct / 100) : CIRCUMFERENCE

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="relative flex items-center justify-center rounded-full hover:bg-overlay-6 transition-colors"
        title={pct != null ? `Context: ${pct}%` : "Session info"}
        style={{ width: SIZE + 4, height: SIZE + 4 }}
      >
        <svg width={SIZE} height={SIZE} className="-rotate-90">
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke="var(--contrast)"
            strokeOpacity={0.08}
            strokeWidth={STROKE}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            stroke={pct != null ? ringColor(pct) : "var(--contrast)"}
            strokeOpacity={pct != null ? 1 : 0.15}
            strokeWidth={STROKE}
            strokeLinecap="round"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            className="transition-all duration-500"
          />
        </svg>
        <span
          className="absolute text-[7px] font-medium"
          style={{ color: pct != null ? ringColor(pct) : "var(--muted-foreground)" }}
        >
          {pct != null ? pct : "--"}
        </span>
      </button>

      <SessionStatsModal
        open={open}
        onOpenChange={setOpen}
        stats={stats}
        messages={messages}
        modelOptions={modelOptions}
        effortOptions={effortOptions}
        qualityTierOptions={qualityTierOptions}
        onConfigChange={onConfigChange}
      />
    </>
  )
}
