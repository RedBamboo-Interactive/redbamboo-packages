import { createContext, useContext } from "react"
import type { HandsFreeContextValue } from "../types"

const noop = () => {}
const noopAsync = async () => {}

export const HandsFreeContext = createContext<HandsFreeContextValue>({
  enabled: false,
  exchangeState: "idle",
  currentSessionId: null,
  currentSessionTitle: null,
  queueLength: 0,
  lastSummary: null,
  lastTranscript: null,
  error: null,
  sessionCount: 0,
  enable: noopAsync,
  disable: noop,
  skip: noop,
  startListening: noopAsync,
  stopListening: noopAsync,
  cancelListening: noop,
})

export function useHandsFree() {
  return useContext(HandsFreeContext)
}
