import { useState, useRef, useCallback, useEffect } from "react"
import type { MessageBlock, SpeechBackend, ExchangeState, HandsFreeContextValue } from "../types"
import { AudioPlayer } from "../lib/audio-player"
import { AudioRecorder } from "../lib/audio-recorder"
import { filterConversation } from "../lib/conversation-filter"

const DEFAULT_SPEAK_INSTRUCTIONS = "Speak in a warm, calm, and confident tone. You are a helpful assistant providing a brief status update."

interface HandsFreeSession {
  id: string
  title?: string
  projectName?: string
  status: string
}

interface Exchange {
  id: string
  sessionId: string
  sessionTitle: string
  messages: MessageBlock[]
}

export interface HandsFreeParams {
  speech: SpeechBackend
  sessions: HandsFreeSession[]
  allMessages: Record<string, MessageBlock[]>
  allStreaming: Record<string, boolean>
  pendingQuestions: Record<string, { question: string } | null>
  sendMessage: (sessionId: string, content: string) => void
  answerQuestion: (sessionId: string, answer: string) => void
  voiceName?: string
  pushToTalkKey?: string
  chimeEnabled?: boolean
  chimeUrl?: string
  notificationsEnabled?: boolean
  notificationTitle?: string
  notificationIcon?: string
  speakInstructions?: string
  mediaSessionTitle?: string
}

function sessionName(s: HandsFreeSession): string {
  return s.title || s.projectName || s.id
}

function isAlive(s: HandsFreeSession): boolean {
  return s.status !== "Stopped" && s.status !== "Error"
}

export function useGlobalHandsFree({
  speech,
  sessions,
  allMessages,
  allStreaming,
  pendingQuestions,
  sendMessage,
  answerQuestion,
  voiceName,
  pushToTalkKey = "F13",
  chimeEnabled = true,
  chimeUrl,
  notificationsEnabled = false,
  notificationTitle = "Hands-Free",
  notificationIcon,
  speakInstructions = DEFAULT_SPEAK_INSTRUCTIONS,
  mediaSessionTitle,
}: HandsFreeParams): HandsFreeContextValue {
  const [enabled, setEnabled] = useState(false)
  const [exchangeState, setExchangeState] = useState<ExchangeState>("idle")
  const [currentExchange, setCurrentExchange] = useState<Exchange | null>(null)
  const [queueLength, setQueueLength] = useState(0)
  const [lastSummary, setLastSummary] = useState<string | null>(null)
  const [lastTranscript, setLastTranscript] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const speechRef = useRef(speech)
  speechRef.current = speech
  const voiceRef = useRef(voiceName)
  voiceRef.current = voiceName
  const chimeEnabledRef = useRef(chimeEnabled)
  chimeEnabledRef.current = chimeEnabled
  const notifRef = useRef(notificationsEnabled)
  notifRef.current = notificationsEnabled
  const speakInstrRef = useRef(speakInstructions)
  speakInstrRef.current = speakInstructions

  const playerRef = useRef<AudioPlayer | null>(null)
  const recorderRef = useRef<AudioRecorder | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const queueRef = useRef<Exchange[]>([])
  const currentExchangeRef = useRef<Exchange | null>(null)
  const enabledRef = useRef(false)
  const exchangeStateRef = useRef<ExchangeState>("idle")
  const prevStreamingMap = useRef<Record<string, boolean>>({})
  const sendMessageRef = useRef(sendMessage)
  sendMessageRef.current = sendMessage
  const answerQuestionRef = useRef(answerQuestion)
  answerQuestionRef.current = answerQuestion
  const pendingQuestionsRef = useRef(pendingQuestions)
  pendingQuestionsRef.current = pendingQuestions
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions

  const syncExchangeState = useCallback((s: ExchangeState) => {
    exchangeStateRef.current = s
    setExchangeState(s)
  }, [])

  const syncQueueLength = useCallback(() => {
    setQueueLength(queueRef.current.length)
  }, [])

  const cleanup = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    playerRef.current?.dispose()
    playerRef.current = null
    recorderRef.current?.dispose()
    recorderRef.current = null
  }, [])

  const runExchange = useCallback(async (exchange: Exchange) => {
    syncExchangeState("summarizing")
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const pending = pendingQuestionsRef.current[exchange.sessionId]
      let summary: string

      if (pending?.question) {
        summary = `${exchange.sessionTitle}: ${pending.question}`
      } else {
        const filtered = filterConversation(exchange.messages)
        if (filtered.length === 0) {
          syncExchangeState("waiting")
          return
        }

        if (speechRef.current.summarize) {
          summary = await speechRef.current.summarize(filtered, exchange.sessionTitle, abort.signal)
        } else {
          const lastAssistant = filtered.filter(e => e.role === "assistant").pop()
          summary = `${exchange.sessionTitle}: ${lastAssistant?.content.slice(0, 200) || "Done."}`
        }
      }

      if (abort.signal.aborted) return
      setLastSummary(summary)

      if (notifRef.current && document.visibilityState === "hidden" && "Notification" in window && Notification.permission === "granted") {
        new Notification(notificationTitle, { body: summary, icon: notificationIcon })
      }

      syncExchangeState("speaking")

      const wavData = await speechRef.current.speak(summary, { voice: voiceRef.current, instructions: speakInstrRef.current }, abort.signal)
      if (abort.signal.aborted) return

      await playerRef.current?.playChimeAndAudio(wavData, chimeEnabledRef.current)
      if (abort.signal.aborted) return

      syncExchangeState("waiting")
    } catch (err) {
      if (abort.signal.aborted) return
      setError(err instanceof Error ? err.message : "Summary failed")
      syncExchangeState("error")
      setTimeout(() => {
        if (exchangeStateRef.current === "error") {
          advanceQueue()
        }
      }, 5000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notificationTitle, notificationIcon])

  const processNext = useCallback(() => {
    const next = queueRef.current.shift()
    syncQueueLength()

    if (!next) {
      currentExchangeRef.current = null
      setCurrentExchange(null)
      syncExchangeState("idle")
      return
    }

    const session = sessionsRef.current.find(s => s.id === next.sessionId)
    if (!session || !isAlive(session)) {
      processNext()
      return
    }

    currentExchangeRef.current = next
    setCurrentExchange(next)
    setLastSummary(null)
    setLastTranscript(null)
    setError(null)
    runExchange(next)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runExchange, syncQueueLength])

  const advanceQueue = useCallback(() => {
    currentExchangeRef.current = null
    setCurrentExchange(null)
    processNext()
  }, [processNext])

  const enqueue = useCallback((exchange: Exchange) => {
    queueRef.current.push(exchange)
    syncQueueLength()
    if (!currentExchangeRef.current) {
      processNext()
    }
  }, [processNext, syncQueueLength])

  useEffect(() => {
    if (!enabledRef.current) return

    const prev = prevStreamingMap.current
    for (const session of sessions) {
      const wasStreaming = prev[session.id] ?? false
      const nowStreaming = allStreaming[session.id] ?? false

      if (wasStreaming && !nowStreaming) {
        if (isAlive(session)) {
          const msgs = allMessages[session.id] ?? []
          if (msgs.length > 0) {
            enqueue({
              id: `${session.id}-${Date.now()}`,
              sessionId: session.id,
              sessionTitle: sessionName(session),
              messages: msgs,
            })
          }
        }
      }
    }
    prevStreamingMap.current = { ...allStreaming }
  }, [allStreaming, sessions, allMessages, enqueue])

  useEffect(() => {
    const current = currentExchangeRef.current
    if (!current) return
    if (allStreaming[current.sessionId] &&
        (exchangeStateRef.current === "waiting" || exchangeStateRef.current === "error")) {
      abortRef.current?.abort()
      playerRef.current?.stop()
      advanceQueue()
    }
  }, [allStreaming, advanceQueue])

  useEffect(() => {
    if (!enabledRef.current) return

    queueRef.current = queueRef.current.filter(ex => {
      const session = sessions.find(s => s.id === ex.sessionId)
      return session && isAlive(session)
    })
    syncQueueLength()

    const current = currentExchangeRef.current
    if (current) {
      const session = sessions.find(s => s.id === current.sessionId)
      if (!session || !isAlive(session)) {
        abortRef.current?.abort()
        playerRef.current?.stop()
        advanceQueue()
      }
    }
  }, [sessions, advanceQueue, syncQueueLength])

  const enable = useCallback(async () => {
    const player = new AudioPlayer()
    await player.init({ chimeUrl, mediaSessionTitle })
    playerRef.current = player

    recorderRef.current = new AudioRecorder()

    if ("Notification" in window && Notification.permission === "default") {
      Notification.requestPermission().catch(() => {})
    }

    setError(null)
    setLastSummary(null)
    setLastTranscript(null)
    queueRef.current = []
    currentExchangeRef.current = null
    setCurrentExchange(null)
    setQueueLength(0)
    prevStreamingMap.current = { ...allStreaming }

    enabledRef.current = true
    setEnabled(true)
    syncExchangeState("idle")

    for (const session of sessionsRef.current) {
      if (isAlive(session)) {
        const streaming = allStreaming[session.id]
        if (streaming) continue
        const msgs = allMessages[session.id] ?? []
        if (msgs.length > 0) {
          enqueue({
            id: `${session.id}-${Date.now()}`,
            sessionId: session.id,
            sessionTitle: sessionName(session),
            messages: msgs,
          })
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allStreaming, allMessages, enqueue, syncExchangeState, chimeUrl, mediaSessionTitle])

  const disable = useCallback(() => {
    enabledRef.current = false
    cleanup()
    queueRef.current = []
    currentExchangeRef.current = null
    setCurrentExchange(null)
    setEnabled(false)
    syncExchangeState("idle")
    setQueueLength(0)
    setError(null)
    setLastSummary(null)
    setLastTranscript(null)
  }, [cleanup, syncExchangeState])

  const skip = useCallback(() => {
    playerRef.current?.stop()
    abortRef.current?.abort()
    abortRef.current = null
    advanceQueue()
  }, [advanceQueue])

  const startListening = useCallback(async () => {
    if (exchangeStateRef.current !== "waiting" || !recorderRef.current) return

    try {
      await recorderRef.current.start()
    } catch {
      setError("Microphone access denied")
      syncExchangeState("error")
      setTimeout(() => {
        if (exchangeStateRef.current === "error") syncExchangeState("waiting")
      }, 3000)
      return
    }

    syncExchangeState("listening")

    if ("mediaSession" in navigator) {
      navigator.mediaSession.setActionHandler("pause", () => {
        if (exchangeStateRef.current === "listening") stopListening()
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncExchangeState])

  const stopListening = useCallback(async () => {
    if (exchangeStateRef.current !== "listening" || !recorderRef.current) return
    const exchange = currentExchangeRef.current
    if (!exchange) return

    const audioBlob = await recorderRef.current.stop()
    syncExchangeState("processing")
    const abort = new AbortController()
    abortRef.current = abort

    try {
      const rawText = await speechRef.current.transcribe(audioBlob, abort.signal)
      if (abort.signal.aborted) return

      const trimmed = rawText.trim()
      setLastTranscript(trimmed)

      if (!trimmed) {
        syncExchangeState("waiting")
        return
      }

      let finalText = trimmed
      if (speechRef.current.reformulate) {
        const context = filterConversation(exchange.messages)
        finalText = await speechRef.current.reformulate(trimmed, context, abort.signal)
        if (abort.signal.aborted) return
      }

      syncExchangeState("sending")
      const pending = pendingQuestionsRef.current[exchange.sessionId]
      if (pending) {
        answerQuestionRef.current(exchange.sessionId, finalText)
      } else {
        sendMessageRef.current(exchange.sessionId, finalText)
      }
      advanceQueue()
    } catch (err) {
      if (abort.signal.aborted) return
      const msg = err instanceof Error ? err.message : "Processing failed"
      setError(msg)
      syncExchangeState("error")
      setTimeout(() => {
        if (exchangeStateRef.current === "error") syncExchangeState("waiting")
      }, 5000)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncExchangeState, advanceQueue])

  const cancelListening = useCallback(() => {
    recorderRef.current?.cancel()
    syncExchangeState("waiting")
  }, [syncExchangeState])

  useEffect(() => {
    return () => {
      enabledRef.current = false
      cleanup()
    }
  }, [cleanup])

  useEffect(() => {
    if (!enabled || (exchangeState !== "waiting" && exchangeState !== "listening")) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== pushToTalkKey || e.repeat || e.shiftKey) return
      e.preventDefault()
      if (exchangeStateRef.current === "waiting") startListening()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key !== pushToTalkKey || e.shiftKey) return
      e.preventDefault()
      if (exchangeStateRef.current === "listening") stopListening()
    }

    window.addEventListener("keydown", onKeyDown)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKeyDown)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [enabled, exchangeState, startListening, stopListening, pushToTalkKey])

  useEffect(() => {
    if (!enabled || exchangeState !== "waiting" || !("mediaSession" in navigator)) return
    navigator.mediaSession.setActionHandler("play", () => {
      if (exchangeStateRef.current === "waiting") startListening()
    })
    return () => {
      navigator.mediaSession.setActionHandler("play", null)
      navigator.mediaSession.setActionHandler("pause", null)
    }
  }, [enabled, exchangeState, startListening])

  useEffect(() => {
    if (!enabled || !("mediaSession" in navigator)) return
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      const s = exchangeStateRef.current
      if (s === "speaking" || s === "waiting") skip()
    })
    return () => {
      navigator.mediaSession.setActionHandler("nexttrack", null)
    }
  }, [enabled, skip])

  const aliveSessionCount = sessions.filter(isAlive).length

  return {
    enabled,
    exchangeState,
    currentSessionId: currentExchange?.sessionId ?? null,
    currentSessionTitle: currentExchange?.sessionTitle ?? null,
    queueLength,
    lastSummary,
    lastTranscript,
    error,
    sessionCount: aliveSessionCount,
    enable,
    disable,
    skip,
    startListening,
    stopListening,
    cancelListening,
  }
}
