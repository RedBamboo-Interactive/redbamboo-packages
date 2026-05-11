import { useCallback } from "react"
import type { VoiceInputHandle } from "../types"
import { MorphSpinner } from "./morph-spinner"

interface VoiceInputButtonProps {
  voice: VoiceInputHandle
  processingLabel?: string
  recordingLabel?: string
  color?: string
  className?: string
}

export function VoiceInputButton({
  voice,
  processingLabel = "Transcribing…",
  recordingLabel = "Listening…",
  color = "var(--color-accent-teal)",
  className = "",
}: VoiceInputButtonProps) {
  const { state, error } = voice

  const retry = useCallback(() => {
    voice.cancelRecording()
    voice.startRecording()
  }, [voice])

  if (state === "processing") {
    return (
      <button
        type="button"
        data-slot="voice-input-button"
        onClick={voice.cancelRecording}
        className={`voice-input-processing ${className}`}
        title="Cancel"
      >
        <MorphSpinner color={color} />
        <span className="voice-input-label">{processingLabel}</span>
      </button>
    )
  }

  if (state === "recording") {
    return (
      <button
        type="button"
        data-slot="voice-input-button"
        onClick={voice.stopRecording}
        className={`voice-input-recording ${className}`}
        title="Stop recording"
      >
        <span className="voice-input-pulse" />
        <i className="fa-solid fa-microphone text-xs" />
        <span className="voice-input-label">{recordingLabel}</span>
      </button>
    )
  }

  if (state === "error") {
    return (
      <button
        type="button"
        data-slot="voice-input-button"
        onClick={retry}
        className={`voice-input-error ${className}`}
        title="Retry"
      >
        <i className="fa-solid fa-microphone-slash text-xs" />
        {error && <span className="voice-input-label">{error}</span>}
      </button>
    )
  }

  return (
    <button
      type="button"
      data-slot="voice-input-button"
      onClick={voice.startRecording}
      className={`voice-input-idle ${className}`}
      title="Voice input"
    >
      <i className="fa-solid fa-microphone text-xs" />
    </button>
  )
}
