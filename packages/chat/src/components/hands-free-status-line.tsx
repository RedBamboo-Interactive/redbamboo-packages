import { useHandsFree } from "../contexts/hands-free"
import { MorphSpinner } from "./morph-spinner"

interface HandsFreeStatusLineProps {
  sessionId?: string | null
  className?: string
}

export function HandsFreeStatusLine({ sessionId, className }: HandsFreeStatusLineProps) {
  const hf = useHandsFree()
  const isMyExchange = hf.enabled && hf.exchangeState !== "idle" && hf.currentSessionId === sessionId
  if (!isMyExchange) return null

  const { exchangeState, lastSummary, lastTranscript, error, queueLength } = hf
  const queueBadge = queueLength > 0 && (
    <span className="text-[10px] text-teal-300 bg-teal-500-a20 px-1.5 py-0.5 rounded-full">
      +{queueLength} waiting
    </span>
  )

  return (
    <div data-slot="hands-free-status-line" className={className}>
      {exchangeState === "summarizing" && (
        <div className="flex items-center gap-2 text-text-muted text-sm py-1">
          <MorphSpinner color="#a78bfa" />
          <span>Summarizing...</span>
          {queueBadge}
        </div>
      )}

      {exchangeState === "speaking" && (
        <div className="flex items-center gap-2 text-sm py-1">
          <i className="fa-solid fa-volume-high text-xs text-teal-400 animate-pulse" />
          <span className="text-text-muted flex-1 line-clamp-2">{lastSummary}</span>
          {queueBadge}
          <button
            onClick={hf.skip}
            className="text-xs text-text-muted hover:text-contrast px-2 py-1 rounded hover:bg-overlay-10 transition-colors"
          >
            Skip
          </button>
        </div>
      )}

      {(exchangeState === "waiting" || exchangeState === "listening") && (
        <div className="flex items-center gap-3 py-1">
          {exchangeState === "listening" ? (
            <>
              <span className="relative flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
              </span>
              <span className="text-red-400 font-medium text-sm flex-1">Listening...</span>
            </>
          ) : (
            <span className="text-xs text-text-muted flex-1 line-clamp-1">
              {lastSummary || "Waiting for your response..."}
            </span>
          )}
          {queueBadge}
          <button
            onClick={hf.skip}
            className="text-xs text-text-muted hover:text-contrast px-2 py-1 rounded hover:bg-overlay-10 transition-colors"
          >
            Skip
          </button>
          <button
            onPointerDown={(e) => { e.preventDefault(); hf.startListening() }}
            onPointerUp={(e) => { e.preventDefault(); hf.stopListening() }}
            onPointerLeave={(e) => { e.preventDefault(); if (exchangeState === "listening") hf.cancelListening() }}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-colors select-none touch-none ${
              exchangeState === "listening"
                ? "bg-red-500-a40 text-red-300"
                : "bg-red-500-a20 text-red-400 hover:bg-red-500-a30 active:bg-red-500-a40"
            }`}
          >
            <i className="fa-solid fa-microphone text-xs" />
            {exchangeState === "listening" ? "Release to send" : "Hold to talk"}
          </button>
        </div>
      )}

      {exchangeState === "processing" && (
        <div className="flex items-center gap-2 text-sm py-1">
          <MorphSpinner color="#fbbf24" />
          <span className="text-text-muted">
            {lastTranscript ? `"${lastTranscript}"` : "Processing voice..."}
          </span>
        </div>
      )}

      {exchangeState === "sending" && (
        <div className="flex items-center gap-2 text-text-muted text-sm py-1">
          <i className="fa-solid fa-paper-plane text-xs text-teal-400" />
          <span>Sending...</span>
        </div>
      )}

      {exchangeState === "error" && (
        <div className="flex items-center gap-2 py-1">
          <i className="fa-solid fa-triangle-exclamation text-sm text-amber-400" />
          <span className="text-amber-400 text-sm">{error}</span>
        </div>
      )}
    </div>
  )
}
