import { useState, useRef, useCallback, useEffect } from "react"
import type { MessageBlock, SpeechBackend, VoiceInputState, VoiceInputHandle, SendOptions } from "../types"
import { AudioRecorder } from "../lib/audio-recorder"
import { filterConversation } from "../lib/conversation-filter"
import { GLOBAL_PUSH_TO_TALK_EVENT, parseGlobalPushToTalkDetail } from "../lib/global-push-to-talk"
import { useUiEnvironment } from "@redbamboo/ui"

export interface VoiceInputParams {
  speech: SpeechBackend
  messages: MessageBlock[]
  onSend: (content: string, options?: SendOptions) => void
  onAnswerQuestion?: (answer: string, payload?: import("../types").QuestionAnswerPayload) => void
  pendingQuestion?: boolean
  disabled?: boolean
  handsFreeEnabled?: boolean
  pushToTalkKey?: string
  globalPushToTalk?: boolean
}

const NOOP_HANDLE: VoiceInputHandle = {
  state: "idle",
  error: null,
  transcript: null,
  interimTranscript: null,
  startRecording: async () => {},
  stopRecording: async () => {},
  cancelRecording: () => {},
}

export function useVoiceInput(params: VoiceInputParams | null): VoiceInputHandle {
  const environment = useUiEnvironment()
  const speech = params?.speech
  const messages = params?.messages ?? []
  const onSend = params?.onSend ?? (() => {})
  const onAnswerQuestion = params?.onAnswerQuestion
  const pendingQuestion = params?.pendingQuestion
  const disabled = params?.disabled ?? !params
  const handsFreeEnabled = params?.handsFreeEnabled
  const pushToTalkKey = params?.pushToTalkKey ?? "F13"
  const globalPushToTalk = params?.globalPushToTalk ?? false
  const [state, setState] = useState<VoiceInputState>("idle")
  const [error, setError] = useState<string | null>(null)
  const [transcript, setTranscript] = useState<string | null>(null)
  const [interimTranscript, setInterimTranscript] = useState<string | null>(null)

  const recorderRef = useRef<AudioRecorder | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const stateRef = useRef<VoiceInputState>("idle")
  const pushToTalkPressedRef = useRef(false)

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
    setInterimTranscript(null)
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

      setInterimTranscript(trimmed)

      let finalText = trimmed
      if (speechRef.current?.reformulate) {
        const context = filterConversation(messagesRef.current)
        finalText = await speechRef.current!.reformulate(trimmed, context, abort.signal)
        if (abort.signal.aborted) return
      }

      setInterimTranscript(null)

      if (pendingRef.current && onAnswerRef.current) {
        // Spoken answers are freeform by nature — the same `response` channel
        // the composer uses, never a selection.
        onAnswerRef.current(finalText, { response: finalText })
      } else {
        onSendRef.current(finalText, { inputMethod: "voice" })
      }
      syncState("idle")
    } catch (err) {
      if (abort.signal.aborted) return
      console.error("[voice] transcription failed:", err)
      const msg = err instanceof Error ? err.message : "Voice processing failed"
      setError(msg)
      setInterimTranscript(null)
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
    setInterimTranscript(null)
    syncState("idle")
  }, [syncState])

  const pressPushToTalk = useCallback(() => {
    if (pushToTalkPressedRef.current) return
    pushToTalkPressedRef.current = true
    if (stateRef.current !== "idle") return
    void startRecording().then(() => {
      if (!pushToTalkPressedRef.current && stateRef.current === "recording")
        void stopRecording()
    })
  }, [startRecording, stopRecording])

  const releasePushToTalk = useCallback(() => {
    pushToTalkPressedRef.current = false
    if (stateRef.current === "recording") void stopRecording()
  }, [stopRecording])

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
      pressPushToTalk()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== pushToTalkKey || e.shiftKey) return
      e.preventDefault()
      releasePushToTalk()
    }

    environment.window.addEventListener("keydown", onKeyDown)
    environment.window.addEventListener("keyup", onKeyUp)
    return () => {
      environment.window.removeEventListener("keydown", onKeyDown)
      environment.window.removeEventListener("keyup", onKeyUp)
    }
  }, [handsFreeEnabled, disabled, pressPushToTalk, releasePushToTalk, pushToTalkKey, environment.window])

  useEffect(() => {
    if (!globalPushToTalk || handsFreeEnabled || disabled) return
    const onGlobalPushToTalk = (event: Event) => {
      const detail = parseGlobalPushToTalkDetail((event as CustomEvent<unknown>).detail)
      if (!detail || detail.key !== pushToTalkKey) return
      if (detail.pressed) pressPushToTalk()
      else releasePushToTalk()
    }
    environment.document.addEventListener(GLOBAL_PUSH_TO_TALK_EVENT, onGlobalPushToTalk)
    return () => {
      environment.document.removeEventListener(GLOBAL_PUSH_TO_TALK_EVENT, onGlobalPushToTalk)
      releasePushToTalk()
    }
  }, [disabled, environment.document, globalPushToTalk, handsFreeEnabled, pressPushToTalk, pushToTalkKey, releasePushToTalk])

  useEffect(() => {
    return () => {
      abortRef.current?.abort()
      pushToTalkPressedRef.current = false
      recorderRef.current?.dispose()
      recorderRef.current = null
    }
  }, [])

  if (!params) return NOOP_HANDLE
  return { state, error, transcript, interimTranscript, startRecording, stopRecording, cancelRecording }
}
