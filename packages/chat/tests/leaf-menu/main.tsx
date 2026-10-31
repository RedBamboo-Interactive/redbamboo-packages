import React from "react"
import { createRoot } from "react-dom/client"
import { configureContextMenu, ContextMenuHost, type ContextMenuEntry } from "@redbamboo/ui"
import { ChatPanel } from "../../src/components/chat-panel"
import type { MessageBlock, MessagePart } from "../../src/types"
import "./fixture.css"

// ?leaf=1 turns the Leaf context menu on, as the shell does for the preference.
// ?host=nova describes its side actions (React); ?host=roleplay has a side
// action the menu cannot reach; no host has none (Code).
window.__events = []
const params = new URLSearchParams(location.search)
const leaf = params.get("leaf") === "1"
const host = params.get("host")
if (leaf) configureContextMenu({ enabled: true, navigate: to => { window.__events.push(`navigate:${to}`) } })

const stamp = "2026-10-31T09:00:00Z"

const CODE_SOURCE = 'const colour = "#ff0000" // keep `ticks` & <tags>\nif (a < b) {\n  return "x"\n}\n'
const USER_TEXT = "Please check `#00ff00` and this:\n\n```ts\nlet n = 1\n```"
const ASSISTANT_FIRST = `Here is the **fix**:\n\n\`\`\`ts\n${CODE_SOURCE}\`\`\``
const ASSISTANT_LAST = "Done. See ![chart](/pic.svg) and [the docs](https://example.invalid/docs)."

const tool = (toolName: string, input: Record<string, unknown>, result: string): MessagePart[] => [
  { type: "tool_use", toolName, toolInput: JSON.stringify(input), content: "" },
  { type: "tool_result", content: result },
]

const messages: MessageBlock[] = [
  { id: "user-1", role: "user", timestamp: stamp, parts: [{ type: "text", content: `<nova-context timestamp="${stamp}" device="phone"></nova-context>\n${USER_TEXT}` }] },
  { id: "assistant-1", role: "assistant", timestamp: stamp, parts: [
    { type: "text", content: ASSISTANT_FIRST },
    ...tool("Read", { file_path: "T:/Projects/example/src/app.ts", offset: 12 }, "12\tconst a = 1"),
    ...tool("agent:Builder", { jobId: "job-42", prompt: "build" }, "done"),
    { type: "text", content: ASSISTANT_LAST },
  ] },
]

declare global {
  interface Window { __events: string[]; __fixture: Record<string, string> }
}
window.__fixture = { CODE_SOURCE, USER_TEXT, ASSISTANT_FIRST, ASSISTANT_LAST }

const renderSideActions = host === "roleplay"
  ? () => <button type="button" data-fixture-side-action aria-label="Edit message">✎</button>
  : host === "nova"
    ? () => <button type="button" data-fixture-side-action aria-label="Add reaction">☺</button>
    : undefined

const getMessageActions = host === "nova"
  ? (block: MessageBlock): ContextMenuEntry[] => [{
    id: "message-react", label: "React", icon: "ph-bold ph-smiley",
    children: ["👍", "🔥"].map(emoji => ({ id: `message-react:${emoji}`, label: emoji, run: () => { window.__events.push(`react:${block.id}:${emoji}`) } })),
  }]
  : undefined

function App() {
  return <div style={{ width: "100%", height: "100vh" }}>
    {leaf && <ContextMenuHost />}
    <ChatPanel
      messages={messages}
      isStreaming={false}
      sessionId="leaf-menu"
      persistQueue={false}
      resolveFileLink={(path, opts) => () => { window.__events.push(`open-file:${path}:${opts?.line ?? ""}`) }}
      renderSideActions={renderSideActions}
      getMessageActions={getMessageActions}
    />
  </div>
}

createRoot(document.getElementById("root")!).render(<App />)
