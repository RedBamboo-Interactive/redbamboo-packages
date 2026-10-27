import React, { useEffect, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { ChatPanel } from "../../src/components/chat-panel"
import type { FocusMessageRequest, FocusMessageResult, MessageBlock } from "../../src/types"
import "./focus.css"

const query = new URLSearchParams(location.search)
document.documentElement.classList.toggle("dark", query.get("theme") !== "light")
if (query.get("accent")) document.documentElement.dataset.accent = query.get("accent")!

const stamp = (index: number) => new Date(Date.UTC(2026, 9, 27, 8, 0, 0) + index * 60_000).toISOString()

const PARAGRAPHS = [
  "Here is the plan: wire the panel to the transcript pager first, then the go-to-message request. Nothing in reconciliation changes.",
  "The window renders only the newest blocks, so a message far above the viewport has to be rendered before it can be scrolled to.",
  "While a turn streams, the viewport must stay where the reader put it. Pinning is released the moment a focus request is honoured.",
]

function conversation(prefix: string, count: number): MessageBlock[] {
  const blocks: MessageBlock[] = []
  for (let i = 0; i < count; i++) {
    const user = i % 2 === 0
    blocks.push({
      id: `${prefix}${user ? "u" : "a"}-${i}`,
      role: user ? "user" : "assistant",
      timestamp: stamp(i),
      parts: [{ type: "text", content: user
        ? `Question ${i}: how does step ${i} behave when the window is narrow?`
        : `Answer ${i}.\n\n${PARAGRAPHS.join("\n\n")}\n\n${PARAGRAPHS[i % 3]}` }],
      ...(i === 6 ? { inputMessageUids: ["queued-six"] } : {}),
    })
  }
  return blocks
}

const results: FocusMessageResult[] = []
const state = {
  results,
  request: (uid: string, nonce: number) => {},
  stream: (ticks: number) => {},
  setSession: (id: string) => {},
  rerenderSameRequest: () => {},
  streamed: 0,
}
;(window as unknown as { focusTest: typeof state }).focusTest = state

function App() {
  const [session, setSession] = useState("a")
  const [messages, setMessages] = useState(() => conversation("", 150))
  const [streaming, setStreaming] = useState(false)
  const [request, setRequest] = useState<FocusMessageRequest | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    state.request = (uid, nonce) => setRequest({ uid, nonce })
    state.rerenderSameRequest = () => setRequest(current => current && { ...current })
    state.setSession = id => {
      setSession(id)
      setMessages(conversation(`${id}-`, 120))
    }
    state.stream = ticks => {
      window.clearInterval(timer.current)
      setStreaming(true)
      let n = 0
      timer.current = window.setInterval(() => {
        n++
        state.streamed++
        setMessages(current => {
          const next = current.slice()
          if (n % 8 === 0) {
            next.push({ id: `live-${state.streamed}`, role: "assistant", timestamp: stamp(900 + state.streamed), parts: [{ type: "text", content: `Live block ${state.streamed}` }] })
          } else {
            const last = next[next.length - 1]
            next[next.length - 1] = { ...last, parts: [{ type: "text", content: `${(last.parts[0] as { content: string }).content} streamed token ${n}.` }] }
          }
          return next
        })
        if (n >= ticks) { window.clearInterval(timer.current); setStreaming(false) }
      }, 40)
    }
  })

  return (
    <div style={{ width: "100%", height: "100vh" }} className="flex">
      <ChatPanel
        messages={messages}
        isStreaming={streaming}
        sessionId={session}
        persistQueue={false}
        hideComposer
        resolveFileLink={() => () => {}}
        focusMessageRequest={request}
        onFocusMessageResult={result => { results.push(result) }}
      />
    </div>
  )
}

createRoot(document.getElementById("root")!).render(<App />)
