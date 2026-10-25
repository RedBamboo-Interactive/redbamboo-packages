import React from "react"
import { createRoot } from "react-dom/client"
import { ChatPanel } from "../../src/components/chat-panel"
import type { MessageBlock, MessagePart } from "../../src/types"
import "./fixture.css"

const tool = (toolUseId: string, toolName: string, input: Record<string, unknown>): MessagePart[] => [
  { type: "tool_use", toolUseId, toolName, toolInput: JSON.stringify(input), content: "" },
  { type: "tool_result", toolUseId, content: "ok" },
]

const messages: MessageBlock[] = [{
  id: "assistant",
  role: "assistant",
  timestamp: "2026-10-25T17:22:23Z",
  parts: [
    { type: "thinking", content: "Looking closely at the supplied images." },
    ...tool("portrait", "view_image", { path: "L:/art/portrait" }),
    ...tool("map", "Read", { file_path: "L:/art/map.png" }),
    ...tool("source", "Read", { file_path: "L:/src/readme.md" }),
    ...tool("search", "Grep", { pattern: "image", path: "L:/src" }),
    { type: "text", content: "The image reads are visible before you open them." },
  ],
}]

const thumbnails: Record<string, string> = {
  "L:/art/portrait": `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#f59e0b"/><stop offset="1" stop-color="#7c3aed"/></linearGradient></defs><rect width="64" height="64" fill="url(#g)"/><circle cx="33" cy="23" r="12" fill="#ffe4c4"/><path d="M12 64c2-22 14-30 21-30s20 8 21 30" fill="#ea580c"/></svg>`,
  "L:/art/map.png": `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="#173f35"/><path d="M4 48L19 13l12 24L46 8l14 40z" fill="#6ee7b7"/><path d="M0 52c16-10 28 8 44-2s20 4 20 4v10H0z" fill="#38bdf8"/></svg>`,
}

function resolveImageSrc(src: string) {
  const svg = thumbnails[src]
  return svg ? `data:image/svg+xml,${encodeURIComponent(svg)}` : undefined
}

function App() {
  return <div className="h-screen w-full"><ChatPanel messages={messages} sessionId="image-read-thumbnail" persistQueue={false} resolveImageSrc={resolveImageSrc} /></div>
}

createRoot(document.getElementById("root")!).render(<App />)
