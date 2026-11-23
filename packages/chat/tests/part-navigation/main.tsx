import React from "react"
import { createRoot } from "react-dom/client"
import { ChatPanel } from "../../src/components/chat-panel"
import { normalizeChatJob } from "../../src/lib/chat-jobs"
import type { FriezeDensity, MessageBlock, MessagePart, PermissionApprovals } from "../../src/types"
import "./fixture.css"

const stamp = "2026-10-19T07:10:00Z"

const tool = (toolName: string, input: Record<string, unknown>, result: string): MessagePart[] => [
  { type: "tool_use", toolName, toolInput: JSON.stringify(input), content: "" },
  { type: "tool_result", content: result },
]

const readOutput = [
  "565\tfunction PartFrieze({ parts, allParts, isLive }: {",
  "566\t  parts: MessagePart[]",
  "567\t  allParts: MessagePart[]",
  "568\t  isLive?: boolean",
  "569\t}) {",
  "570\t  const [selected, setSelected] = useState<Selection | null>(null)",
  "571\t  const retainedSelection = useRef<typeof selected>(null)",
  "572\t  if (selected) retainedSelection.current = selected",
  "573\t  const modalSelection = selected ?? retainedSelection.current",
  "574\t",
  "575\t  const handleClick = (part: MessagePart) => {",
  "576\t    setSelected({ part, index: allParts.indexOf(part) })",
  "577\t  }",
  "578\t",
  "579\t  return (",
  "580\t    <>",
  "581\t      <div className=\"flex flex-wrap items-center gap-[3px] py-1.5 px-0.5\">",
  "582\t        {parts.filter(p => p.type !== \"tool_result\").map((part, i) => (",
  "583\t          <button key={i} onClick={() => handleClick(part)} />",
  "584\t        ))}",
  "585\t      </div>",
  "586\t      <PartModal part={modalSelection?.part} open={!!selected} />",
  "587\t    </>",
  "588\t  )",
  "589\t}",
].join("\n")

const messages: MessageBlock[] = [
  { id: "user", role: "user", timestamp: stamp, parts: [{ type: "text", content: "When looking at tool squares modals, it'd be great to have arrows to move to the next or previous one." }] },
  { id: "assistant", role: "assistant", timestamp: stamp, parts: [
    { type: "thinking", messageId: "t1", thinkingState: "completed", content: "The modal lives in `PartFrieze`. Navigation should walk **every square in the turn**, including the ones after commentary, and stop at both ends rather than wrapping." },
    ...tool("Read", { file_path: "T:/Projects/redbamboo-packages/packages/chat/src/components/chat-message.tsx", offset: 565, limit: 25 }, readOutput),
    ...tool("Grep", { pattern: "PartModal", path: "T:/Projects/redbamboo-packages/packages/chat/src" }, "packages/chat/src/components/chat-message.tsx:622\npackages/chat/src/components/chat-message.tsx:651"),
    ...tool("Glob", { pattern: "**/dialog.tsx", path: "T:/Projects/redbamboo-packages/packages/ui/src" }, "T:/Projects/redbamboo-packages/packages/ui/src/components/dialog.tsx"),
    { type: "text", phase: "commentary", content: "Found the modal. Wiring the arrows into its header now." },
    ...tool("Edit", { file_path: "T:/Projects/redbamboo-packages/packages/chat/src/components/chat-message.tsx", old_string: "  const handleClick = (part: MessagePart) => {\n    setSelected({ part, index: allParts.indexOf(part) })\n  }", new_string: "  const handleClick = (part: MessagePart) => {\n    setMinHeight(0)\n    select(allParts.indexOf(part))\n  }" }, "The file chat-message.tsx has been updated successfully."),
    ...tool("Bash", { command: "npx tsc --noEmit && pnpm test", description: "Typecheck and run chat tests" }, "# tests 244\n# pass 244\n# fail 0"),
    { type: "text", content: "Done. Arrows are in the header, and left/right on the keyboard step through every square in the turn." },
  ] },
]

// `?jobs` (89efca37): the same turn launched two jobs, drawn as twins after its
// last frieze (Edit, Bash), and a woken second turn follows with an origin dot,
// an inline event label and a Bash waiting for approval, so stepping crosses
// squares -> twins -> squares and the second row's markers can be compared with
// jobs on and off (`?jobs&off`). The default page is unchanged.
const params = new URLSearchParams(location.search)
const later = "2026-10-19T07:21:00Z"
const secondTurn: MessageBlock[] = [
  { id: "user-2", role: "user", timestamp: "2026-10-19T07:20:00Z", parts: [{ type: "text", content: "And the covers?" }] },
  { id: "assistant-2", role: "assistant", timestamp: later, metadata: { messageUid: "turn-2", turnOrigin: { kind: "background-task", taskId: "task-covers" } }, parts: [
    { type: "tool_use", toolName: "event:weather", messageId: "ev-1", toolInput: JSON.stringify({ event: "Rain expected at 16:00", label: "Rain at 4pm", inlineLabel: true }), content: "" },
    { ...tool("Read", { file_path: "T:/covers/brief.md" }, "Four covers, one boss.")[0], toolUseId: "toolu_r2" },
    { ...tool("Read", { file_path: "T:/covers/brief.md" }, "Four covers, one boss.")[1], toolUseId: "toolu_r2" },
    { type: "tool_use", toolName: "Bash", toolUseId: "toolu_b2", toolInput: JSON.stringify({ command: "rm -rf T:/covers/old" }), content: "" },
    { type: "text", content: "Clearing the old covers once you approve." },
  ] },
]
const approvals: PermissionApprovals = {
  toolu_b2: { key: "toolu_b2", requestId: "req-1", request: { toolName: "Bash", toolUseId: "toolu_b2", summary: "rm -rf T:/covers/old" }, outcome: null },
}
const jobs = [
  normalizeChatJob({ id: "covers", capability: "image-gen", providerName: "ComfyUI", name: "Launch covers", status: "Running", stage: "executing", progress: 0.62, queuedAt: "2026-10-19T07:12:00Z", startedAt: "2026-10-19T07:12:00Z" }),
  normalizeChatJob({ id: "theme", capability: "music-gen", providerName: "Suno", name: "Mossbound theme", status: "Queued", stage: "admitted", queuedAt: "2026-10-19T07:13:00Z" }),
]

const noteDiscussionTitle = "A long initiative title with enough words to wrap across several lines on a small screen"
const noteMessages: MessageBlock[] = [{
  id: "note-turn", role: "assistant", timestamp: stamp,
  parts: ["agent-note", "agent-note-sent"].map(key => ({
    type: "tool_use", toolName: `event:${key}`, content: "A note with **Markdown**.",
    toolInput: JSON.stringify({ event: "A note with **Markdown**.", timestamp: stamp, postedAt: later }),
  })),
}]

const densityMessages: MessageBlock[] = [
  ...messages.map((block): MessageBlock => ({
    ...block,
    parts: block.parts.map(part => part.content === readOutput ? { ...part, content: "Error: file unreadable" } : part),
  })),
  ...secondTurn,
  { id: "ambient", role: "assistant", timestamp: later, parts: [
    { type: "tool_use", toolName: "event:weather", toolInput: '{"color":"var(--color-accent-gold)"}', content: "" },
    { type: "tool_use", toolName: "event:hidden", content: "" },
  ] },
  { id: "legacy", role: "user", timestamp: later, parts: [
    { type: "text", content: '<nova-event source="Automation" type="http-check">Ping</nova-event>' },
  ] },
  { id: "hidden", role: "assistant", timestamp: later, parts: [{ type: "tool_use", toolName: "event:hidden", content: "" }] },
]

function App() {
  const density = params.get("density")
  if (density) return <div style={{ width: "100%", height: "100vh" }}>
    <ChatPanel messages={densityMessages} isStreaming={false} sessionId="frieze-density" persistQueue={false}
      friezeDensity={density === "default" ? undefined : density as FriezeDensity}
      permissionApprovals={approvals} jobs={jobs}
      isFriezeMarkerVisible={part => part.toolName !== "Grep" && part.toolName !== "event:hidden"} />
  </div>

  const withJobs = params.has("jobs")
  if (params.has("notes")) return <div style={{ width: "100%", height: "100vh" }}>
    <ChatPanel messages={noteMessages} isStreaming={false} sessionId="part-navigation-notes" persistQueue={false}
      resolveAgentNote={event => ({
        lead: event.key === "agent-note-sent" ? "Note to Nova in" : "Note from Nova in",
        discussion: noteDiscussionTitle, avatarUrl: null, discussionHref: "/another-discussion",
      })} />
  </div>
  return <div style={{ width: "100%", height: "100vh" }}>
    <ChatPanel messages={withJobs ? [...messages, ...secondTurn] : messages} isStreaming={false} sessionId="part-navigation" persistQueue={false}
      resolveFileLink={() => () => {}}
      {...(withJobs ? { permissionApprovals: approvals, ...(params.has("off") ? {} : { jobs, onStopJob: () => {} }) } : {})} />
  </div>
}

createRoot(document.getElementById("root")!).render(<App />)
