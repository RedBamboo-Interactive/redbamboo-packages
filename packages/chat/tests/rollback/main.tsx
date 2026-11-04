import React, { useState } from "react"
import { createRoot } from "react-dom/client"
import { configureContextMenu, ContextMenuHost, type ContextMenuEntry } from "@redbamboo/ui"
import { ChatPanel } from "../../src/components/chat-panel"
import type { ConversationRollback, MessageBlock } from "../../src/types"
import "./fixture.css"

// ?leaf=1 is the Leaf menu preference. ?capable=0 is a provider without the capability.
// ?state=streaming|question|background is a session that is not idle. ?refuse=1 is a server 409.
declare global {
  interface Window { __requests: string[] }
}
window.__requests = []
const params = new URLSearchParams(location.search)
const leaf = params.get("leaf") === "1"
const capable = params.get("capable") !== "0"
const state = params.get("state")
if (leaf) configureContextMenu({ enabled: true, navigate: () => {} })

const stamp = "2026-11-04T09:00:00Z"
const initial: MessageBlock[] = [
  { id: "user-1", role: "user", timestamp: stamp, parts: [{ type: "text", content: "A fact to keep" }] },
  { id: "assistant-1", role: "assistant", timestamp: stamp, parts: [{ type: "text", content: "Kept reply" }] },
  { id: "user-2", role: "user", timestamp: stamp, parts: [{ type: "text", content: `<nova-context timestamp="${stamp}">hidden</nova-context>\nThe message that was refused` }] },
  { id: "assistant-2", role: "assistant", timestamp: stamp, parts: [{ type: "error", content: "API Error: safeguards flagged this message" }] },
]

function App() {
  const [messages, setMessages] = useState(initial)
  const rollback: ConversationRollback = {
    supported: capable,
    request: async uid => {
      window.__requests.push(uid)
      if (params.get("refuse") === "1")
        throw new Error("This conversation can't be rewound right now: a turn is running.")
      setMessages(current => current.slice(0, current.findIndex(message => message.id === uid)))
      return { restoredText: initial.find(message => message.id === uid)?.parts[0].content }
    },
  }
  return <div style={{ width: "100%", height: "100vh" }}>
    {leaf && <ContextMenuHost />}
    <ChatPanel
      messages={messages}
      isStreaming={state === "streaming"}
      sessionId="rollback"
      persistQueue={false}
      rollback={rollback}
      pendingQuestion={state === "question" ? { question: "Which?", questions: [], requestId: "q" } as never : null}
      backgroundTasks={state === "background" ? [{ taskId: "t", kind: "shell", status: "running", startedAt: stamp } as never] : []}
      getMessageActions={(): ContextMenuEntry[] => []}
    />
  </div>
}

createRoot(document.getElementById("root")!).render(<App />)
