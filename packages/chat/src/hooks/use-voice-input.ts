import { useState, useRef, useCallback, useEffect } from "react"
import type { MessageBlock, SpeechBackend, VoiceInputState, VoiceInputHandle } from "../types"
import { AudioRecorder } from "../lib/audio-recorder"
import { filterConversation } from "../lib/conversation-filter"

export interface VoiceInputParams {
  speech: SpeechBackend
  messages: MessageBlock[]
  onSend: (content: string) => void
  onAnswerQuestion?: (answer: string) => void
  pendingQuestion?: boolean
  disabled?: boolean
  handsFreeEnabled?: boolean
  pushToTalkKey?: string
}

const NOOP_HANDLE: VoiceInputHandle = {
  state: "idle",
  error: null,
  transcript: null,
  startRecording: async () => {},
  stopRecording: async () => {},
  cancelRecording: () => {},
}

export function useVoiceInput(params: VoiceInputParams | null): VoiceInputHandle {
  const speech = params?.speech
  const messages = params?.messages ?? []
  const onSend = params?.onSend ?? (() => {})
  const onAnswerQuestion = params?.onAnswerQuestion
  const pendingQuestion = params?.pendingQuestion
  const disabled = params?.disabled ?? !params
  const handsFreeEnabled = params?.handsFreeEnabled
  const pushToTalkKey = params?.pushToTalkKey ?? "F13"
  const [state, setState] = useState<VoiceInputState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)

  const recorderRef = useRef<AudioRecorder | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stateRef = useRef<VoiceInputState>("idle")

  const messagesRef = useRef(messages)
  messagesRef.current = messages
  const onSendRef = useRef(onSend)
  onSendRef.current = onSend
  const onAnswerRef = useRef(onAnswerQuestion)
  onAnswerRef.current = onAnswerQuestion
  const pendingRef = useRef(pendingQuestion)
  pendingRef.current = pendingQuestion
  const speechRef = useRef(speech)
  speechRef.current = speech
  const activeRef = useRef(!!params)
  activeRef.current = !!params

  const syncState = useCallback((s: VoiceInputState) => {
    stateRef.current = s
    setState(s)
  }, [])

  const startRecording = useCallback(async () => {
    if (stateRef.current !== "idle" || disabled || !activeRef.current) return

    if (!recorderRef.current) {
      recorderRef.current = new AudioRecorder()
    }

    try {
      await recorderRef.current.start()
    } catch {
      setError("Microphone access denied")
      syncState("error")
      setTimeout(() => {
        if (stateRef.current === "error") syncState("idle")
      }, 3000)
      return
    }

    setError(null)
    setTranscript(null)
    syncState("recording")
  }, [disabled, syncState])

  const stopRecording = useCallback(async () => {
    if (stateRef.current !== "recording" || !recorderRef.current) return

    const audioBlob = await recorderRef.current.stop()
    syncState("processing")
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const rawText = await speechRef.current!.transcribe(audioBlob, abort.signal)
      if (abort.signal.aborted) return

      const trimmed = rawText.trim()
      setTranscript(trimmed)

      if (!trimmed) {
        syncState("idle")
        return
      }

      let finalText = trimmed
      if (speechRef.current?.reformulate) {
        const context = filterConversation(messagesRef.current)
        finalText = await speechRef.current!.reformulate(trimmed, context, abort.signal)
        if (abort.signal.aborted) return
      }

      if (pendingRef.current && onAnswerRef.current) {
        onAnswerRef.current(finalText)
      } else {
        onSendRef.current(finalText)
      }
      syncState("idle")
    } catch (err) {
      if (abort.signal.aborted) return
      const msg = err instanceof Error ? err.message : "Voice processing failed"
      setError(msg)
      syncState("error")
      setTimeout(() => {
        if (stateRef.current === "error") syncState("idle")
      }, 5000)
    }
  }, [syncState])

  const cancelRecording = useCallback(() => {
    if (stateRef.current === "recording") {
      recorderRef.current?.cancel()
    }
    if (stateRef.current === "processing") {
      abortRef.current?.abort()
    }
    setError(null)
    syncState("idle")
  }, [syncState])

  useEffect(() => {
    if (disabled && (stateRef.current === "recording" || stateRef.current === "processing")) {
      cancelRecording()
    }
  }, [disabled, cancelRecording])

  useEffect(() => {
    if (handsFreeEnabled || disabled) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== pushToTalkKey || e.repeat || e.shiftKey) return
      e.preventDefault()
      if (stateRef.current === "idle") startRecording()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== pushToTalkKey || e.shiftKey) return
      e.preventDefault()
      if (stateRef.current === "recording") stopRecording()
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [handsFreeEnabled, disabled, startRecording, stopRecording, pushToTalkKey])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      recorderRef.current?.dispose()
      recorderRef.current = null
    }
  }, [])

  if (!params) return NOOP_HANDLE
  return { state, error, transcript, startRecording, stopRecording, cancelRecording }
}
