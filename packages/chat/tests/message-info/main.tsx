import React from "react"
import { createRoot } from "react-dom/client"
import { ToastProvider } from "@redbamboo/ui"
import { ChatMessage } from "../../src/components/chat-message"
import type { MessageBlock } from "../../src/types"
import "./fixture.css"

// Message Info for a user message. ?case=
//   full     a stored full context (~10 KB, as Nova injects on a discussion's first message)
//   delta    a stored delta context with the prior assistant message
//   missing  a host that records contexts, but not for this older message (novaContextBlock: null)
//   xml      another product: the context lives in the message text (the XML fallback)
//   none     no context at all (Code)
const params = new URLSearchParams(location.search)
const kind = params.get("case") ?? "full"
const stamp = "2026-11-10T09:00:00.000Z"

const OUTFIT = "You're wearing \"Navy evening\" today (a navy cashmere hoodie over a white tee, slim grey jeans, white leather sneakers, a thin silver ring and a black canvas watch strap, hair loose). You chose it because: it's raining and the day is mostly desk work.\nSee it: http://127.0.0.1:18804/api/assets/outfit-navy-evening.png"

function fullContext(): string {
  const discussions = Array.from({ length: 48 }, (_, i) =>
    `- [d${String(i).padStart(7, "0")}] "Work item ${i + 1}: refactor the asset pipeline stage ${i + 1}" . ${3 + i} msgs . ${i + 2}min ago${i === 0 ? " <- you are here" : ""}`)
  const archived = Array.from({ length: 30 }, (_, i) =>
    `- [a${String(i).padStart(7, "0")}] "Archived investigation ${i + 1} on texture streaming" . ${8 + i} msgs . archived ${i + 1}d ago`)
  const others = Array.from({ length: 5 }, (_, i) => `- [o${String(i).padStart(7, "0")}] "Storyboard: chapter ${i + 3}" . ${5 + i} msgs . ${30 + i}min ago`)
  const events = [
    "- [automation] Morning brief completed: 12°C, light rain; 2 meetings (40min ago)",
    "- [callback] Code session 3f2a finished: tests green on main (31min ago)",
    "- [discussion] Laurent in \"CC3 assets\": export the atlas at 2048 (22min ago)",
    "- [presence] Laurent is at the office (15min ago)",
    "- [device] Switched to Desktop (9min ago)",
  ]
  return [
    `<nova-context timestamp="2026-11-10T09:00:00Z" day="Tuesday" device="Desktop" device_type="desktop" platform="windows" input="text" discussion="d0000000" message="5d1f0c2a9b8e47c3a6f4e2d1c0b9a876" agent="Nova">`,
    "Mood: Focused, a little tired",
    "Active discussions:", ...discussions, "",
    "Recently archived:", ...archived, "",
    "Other agents' active discussions:", ...others, "",
    "Recall any discussion: curl -s http://127.0.0.1:18804/api/apps/nova/discussions/{id}/export -H \"Authorization: Bearer $REDLEAF_EXECUTION_TOKEN\"",
    "Search all discussions: curl -s \"http://127.0.0.1:18804/api/apps/nova/discussions/search?q={query}\" -H \"Authorization: Bearer $REDLEAF_EXECUTION_TOKEN\"",
    "Get full context snapshot: curl -s http://127.0.0.1:18804/api/apps/nova/discussions/{id}/context -H \"Authorization: Bearer $REDLEAF_EXECUTION_TOKEN\"",
    "",
    "Recent LIVE events:", ...events, "",
    "Installed extension context:",
    "- [mail] Mail connected (l***@example.com): 3 unread in Inbox. Use the mail skill to search or read.",
    "- [presence] Presence answers \"Where am I?\": At the office. Confidence: high.",
    "",
    OUTFIT,
    "",
    "Working in worktree: nova · main at T:/Projects/nova",
    "",
    "When a reaction or nothing at all says it better than words, make your entire reply exactly <nova-no-reply/>: the turn then ends with no visible message.",
    "</nova-context>",
  ].join("\n")
}

const DELTA = [
  `<nova-context timestamp="2026-11-10T09:12:00Z" day="Tuesday" device="android phone" device_type="phone" platform="android" input="voice" discussion="d0000000" message="7a2e" agent="Nova">`,
  "Changes since last message:",
  "- 2 new messages in [d0000000] \"Work item 1: refactor the asset pipeline stage 1\"",
  "- [automation] Nightly build passed",
  "- Outfit changed: You're wearing \"Gym\" today (black leggings, grey top, white trainers).",
  "Working in worktree: nova · main at T:/Projects/nova",
  "</nova-context>",
  "<nova-prior-message role=\"assistant\">",
  "Shall I export the atlas at 2048 or keep 4096 for the hero props?",
  "</nova-prior-message>",
  "",
].join("\n")

const novaFields = (device: string, input: string) => ({
  timestamp: stamp, day: "Tuesday", device, deviceType: device === "Desktop" ? "desktop" : "phone",
  devicePlatform: device === "Desktop" ? "windows" : "android", input, discussion: "d0000000", agent: "Nova",
  activeDiscussionCount: 24, archivedDiscussionCount: 12, otherAgentDiscussionCount: 5, extensionContextCount: 2,
  outfit: OUTFIT,
})

function block(): MessageBlock {
  const base = { id: "u1", role: "user" as const, timestamp: stamp }
  switch (kind) {
    case "delta":
      return { ...base, parts: [{ type: "text", content: "Keep 4096 for the hero props." }],
        metadata: { ...novaFields("android phone", "voice"), novaContextBlock: DELTA, source: "session-transcript", messageUid: "u1" } }
    case "missing":
      return { ...base, parts: [{ type: "text", content: "An older message." }], metadata: { messageUid: "u1", novaContextBlock: null } }
    case "xml":
      return { ...base, parts: [{ type: "text", content: `<nova-context timestamp="2026-11-10T09:00:00Z" device="Laptop" input="text">\nSome other product's context\n</nova-context>\nHello` }] }
    case "none":
      return { ...base, parts: [{ type: "text", content: "A Code message." }] }
    default:
      return { ...base, parts: [{ type: "text", content: "Export the atlas, please." }],
        metadata: { ...novaFields("Desktop", "text"), novaContextBlock: fullContext(), source: "session-transcript", messageUid: "u1" } }
  }
}

;(window as unknown as { __context: string }).__context = kind === "delta" ? DELTA : fullContext()

createRoot(document.getElementById("root")!).render(
  <ToastProvider>
    <div className="mx-auto max-w-3xl p-4">
      <ChatMessage block={block()} animateEntrance={false} />
    </div>
  </ToastProvider>,
)
