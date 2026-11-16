import React, { useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { WsEventContext, type WsEventContextValue } from "@redbamboo/utility"
import { ChatPanel } from "../../src/components/chat-panel"
import { JobCard } from "../../src/components/job-card"
import { MediaLightbox } from "../../src/components/streaming-text"
import { useChatJobs } from "../../src/hooks/use-chat-jobs"
import { normalizeChatJob, type ComputeJobRecord } from "../../src/lib/chat-jobs"
import type { ChatJobsTransport } from "../../src/lib/chat-jobs-sync"
import { rebuildBlocks, type PersistedMessage } from "../../src/lib/rebuild-blocks"
import type { ActivityStatusGroup, MessagePart } from "../../src/types"
import "./fixture.css"

// Job cards fixture: a long conversation built through rebuildBlocks, as hosts
// load history, with the real useChatJobs reading a fake authorized transport
// and a WebSocket context the test drives. `window.__jobs` controls the store,
// the frames and the setting; every transport call is counted.

// Recent, like real jobs: discovery lists from the last list on, not from the start.
const T0 = Math.floor((Date.now() - 15 * 60 * 1000) / 60000) * 60000
const ts = (second: number) => new Date(T0 + second * 1000).toISOString()
let sequence = 0
const record = (fields: Partial<PersistedMessage> & Pick<PersistedMessage, "role" | "eventType">, second: number): PersistedMessage => ({
  id: ++sequence, epoch: "fixture", sequence, timestamp: ts(second), ...fields,
})

const filler: PersistedMessage[] = []
for (let turn = 0; turn < 14; turn++) {
  const base = turn * 60
  filler.push(record({ role: "user", eventType: "text", messageUid: `u-${turn}`, content: `Question ${turn}: what about step ${turn}?` }, base))
  filler.push(record({ role: "assistant", eventType: "tool_use", toolName: "Read", messageId: `t-${turn}`, messageUid: `a-${turn}`, toolInput: JSON.stringify({ file_path: `T:/notes/${turn}.md` }) }, base + 2))
  filler.push(record({ role: "assistant", eventType: "tool_result", messageId: `t-${turn}`, messageUid: `a-${turn}`, toolResult: "ok" }, base + 3))
  filler.push(record({ role: "assistant", eventType: "text", messageUid: `a-${turn}`, content: `Answer ${turn}. `.repeat(18) }, base + 4))
}
const LAUNCH = 14 * 60
const launch: PersistedMessage[] = [
  record({ role: "user", eventType: "text", messageUid: "u-launch", content: "Can you make four launch covers for Mossbound, and a short theme to go with them?" }, LAUNCH),
  record({ role: "assistant", eventType: "thinking", messageUid: "a-launch", content: "Covers first." }, LAUNCH + 1),
  record({ role: "assistant", eventType: "tool_use", toolName: "Bash", messageId: "t-covers", messageUid: "a-launch", toolInput: JSON.stringify({ command: "curl -X POST /image-gen/generate" }) }, LAUNCH + 2),
  record({ role: "assistant", eventType: "tool_result", messageId: "t-covers", messageUid: "a-launch", toolResult: "{\"jobId\":\"covers\"}" }, LAUNCH + 3),
  record({ role: "assistant", eventType: "tool_use", toolName: "Bash", messageId: "t-theme", messageUid: "a-launch", toolInput: JSON.stringify({ command: "curl -X POST /music-gen/generate" }) }, LAUNCH + 4),
  record({ role: "assistant", eventType: "tool_result", messageId: "t-theme", messageUid: "a-launch", toolResult: "{\"jobId\":\"theme\"}" }, LAUNCH + 5),
  record({ role: "assistant", eventType: "text", messageUid: "a-launch", content: "Both are on your GPU. Covers first; the theme starts as soon as they finish. I'll pick the strongest cover when they land." }, LAUNCH + 6),
]
const landed = record({ role: "assistant", eventType: "text", messageUid: "a-landed",
  content: "Both done. The boss cover is the one: it reads at thumbnail size.\n\n![Boss cover](" + art("#3f8f4a", "#d4aa4f") + ")" }, LAUNCH + 200)
const landedUser = record({ role: "user", eventType: "text", messageUid: "u-landed", content: "Show me what came out." }, LAUNCH + 198)

function art(a: string, b: string): string {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><circle cx="160" cy="110" r="48" fill="rgba(255,255,255,.35)"/></svg>`
  return `data:image/svg+xml;base64,${btoa(svg)}`
}
const ART = [art("#2d6a4f", "#95d5b2"), art("#e76f51", "#f4a261"), art("#264653", "#2a9d8f"), art("#6d597a", "#e56b6f")]

declare global {
  interface Window {
    __jobs: {
      store: Map<string, ComputeJobRecord>
      calls: string[]
      set(records: ComputeJobRecord[]): void
      frame(type: string, data: unknown): void
      setEnabled(enabled: boolean): void
      setLanded(landed: boolean): void
      setDelegations(on: boolean): void
      setHideShell(on: boolean): void
      setHasEarlier(on: boolean): void
      art: string[]
      ts: (second: number) => string
      launch: number
    }
  }
}

const store = new Map<string, ComputeJobRecord>()
const calls: string[] = []
const listeners = new Set<(event: { type: string; data: unknown }) => void>()
const ws: WsEventContextValue = {
  subscribe: handler => { listeners.add(handler); return () => listeners.delete(handler) },
  dispatch: event => { for (const handler of listeners) handler(event) },
}
const transport: ChatJobsTransport = {
  async list(window) {
    calls.push(`list ${window.since}${window.until ? ` ${window.until}` : ""}`)
    return [...store.values()].filter(job => Date.parse(job.queuedAt ?? "") >= Date.parse(window.since)
      && (!window.until || Date.parse(job.queuedAt ?? "") < Date.parse(window.until))).map(job => ({ ...job }))
  },
  async get(id) {
    calls.push(`get ${id}`)
    const job = store.get(id)
    return job ? { ...job } : null
  },
}

const delegations: ActivityStatusGroup = {
  label: "1 delegation ongoing…",
  icon: "ph-bold ph-code",
  items: [{ key: "d1", title: "Delegation", label: "Pin bump: running", color: "rgb(236 72 153)", shape: "circle", running: true,
    renderDetails: () => <p data-slot="fixture-delegation">Pin bump</p> }],
}

function App() {
  const params = new URLSearchParams(location.search)
  const [enabled, setEnabled] = useState(!params.has("off"))
  const [withLanded, setWithLanded] = useState(false)
  const [withDelegations, setWithDelegations] = useState(false)
  const [hideShell, setHideShell] = useState(false)
  const [hasEarlier, setHasEarlier] = useState(false)
  const [, force] = useState(0)
  const messages = useMemo(() => rebuildBlocks([...filler, ...launch, ...(withLanded ? [landedUser, landed] : [])]), [withLanded])
  const stops = useRef<string[]>([])
  window.__jobs = {
    store, calls, art: ART, ts, launch: LAUNCH,
    set(records) { store.clear(); for (const job of records) store.set(job.id, job); force(n => n + 1) },
    frame(type, data) { ws.dispatch({ type, data }) },
    setEnabled, setLanded: setWithLanded, setDelegations: setWithDelegations, setHideShell, setHasEarlier,
  }
  const jobs = useChatJobs({
    enabled, conversationKey: "fixture-discussion", since: messages[0]?.timestamp, transport,
    mayConcern: data => (data as { discussion?: string }).discussion === "fixture-discussion",
    jobHref: id => `/apps/compute/jobs?select=${id}`,
  })
  const isMarkerShown = useMemo(() => hideShell
    ? (part: MessagePart) => !(part.type === "tool_use" && part.toolName === "Bash")
    : undefined, [hideShell])
  return <div style={{ width: "100%", height: "100vh", display: "flex", flexDirection: "column" }}>
    <ChatPanel messages={messages} isStreaming={false} sessionId="job-cards" persistQueue={false}
      hasEarlierMessages={hasEarlier}
      jobs={jobs}
      onStopJob={job => { stops.current.push(job.id); store.set(job.id, { ...store.get(job.id)!, status: "Cancelled", stage: "cancelled" }) }}
      hostActivity={withDelegations ? delegations : null}
      isFriezeMarkerVisible={isMarkerShown} />
  </div>
}

/** Every state and kind side by side, like the approved mockup's sections 3 and 4. */
function Gallery() {
  const base = { providerName: "ComfyUI", queuedAt: ts(0), startedAt: ts(0) }
  const href = (id: string) => `/apps/compute/jobs?select=${id}`
  const now = Date.now()
  const states: Array<[string, ComputeJobRecord]> = [
    ["Queued", { ...base, id: "g-q", capability: "image-gen", name: "Launch covers", status: "Queued", stage: "admitted" }],
    ["Running, no real progress yet", { ...base, id: "g-w", capability: "image-gen", name: "Launch covers", status: "Running", stage: "waiting", progress: 0, startedAt: new Date(now - 14000).toISOString() }],
    ["Running, real progress", { ...base, id: "g-p", capability: "image-gen", name: "Launch covers", status: "Running", stage: "executing", progress: 0.62 }],
    ["Failed", { ...base, id: "g-f", capability: "video-gen", name: "Trailer cut", providerName: "Wan 2.2", status: "Failed", stage: "failed", errorMessage: "CUDA out of memory while decoding frame 34", queuedAt: ts(0), durationMs: 120000 }],
    ["Done, result kept in the card", { ...base, id: "g-d", capability: "image-gen", name: "Launch covers", status: "Completed", durationMs: 72000, outputs: ART.map((url, i) => ({ url, contentType: "image/svg+xml", sizeBytes: i })) }],
    ["Running, two of four in", { ...base, id: "g-r", capability: "image-gen", name: "Launch covers", status: "Running", stage: "executing", progress: 0.5 }],
    ["Done, one image", { ...base, id: "g-c", capability: "image-gen", name: "Level map", status: "Completed", durationMs: 38000, prompt: "A top-down level map of a mossy ruin, hand-inked, warm light", outputs: [{ url: ART[2], contentType: "image/svg+xml" }] }],
    ["Stopped", { ...base, id: "g-s", capability: "model-download", name: "Model download", status: "Cancelled", stage: "cancelled" }],
  ]
  const kinds: Array<[string, ComputeJobRecord]> = [
    ["Video", { ...base, id: "k-v", capability: "video-gen", name: "Trailer cut", providerName: "Wan 2.2", status: "Running", progress: 0.34 }],
    ["Music", { ...base, id: "k-m", capability: "music-gen", name: "Mossbound theme", providerName: "Suno", status: "Running", progress: 0.45 }],
    ["Music, done", { ...base, id: "k-md", capability: "music-gen", name: "Mossbound theme", providerName: "Suno", status: "Completed", durationMs: 48000, outputs: [{ url: "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", contentType: "audio/wav" }] }],
    ["Workflow", { ...base, id: "k-w", capability: "workflow", name: "Monday support digest", providerName: "RedLeaf Workflow Engine", status: "Running", progress: 0.56 }],
    ["Generic", { ...base, id: "k-g", capability: "model-download", name: "Qwen-Image 2.1", providerName: "Model download", status: "Running", progress: 0.36 }],
  ]
  const steps: ComputeJobRecord[] = ["Read inbox", "Group", "Summarize", "Send"].map((name, index) => ({
    id: `k-w-${index}`, capability: "workflow-step", name, parentJobId: "k-w", queuedAt: ts(index),
    status: index < 2 ? "Completed" : index === 2 ? "Running" : "Queued", progress: index === 2 ? 0.45 : 0, durationMs: 9000,
  }))
  const batch: ComputeJobRecord[] = ART.map((url, index) => ({
    id: `g-r-${index}`, capability: "image-gen", name: `Cover ${index + 1}`, parentJobId: "g-r", queuedAt: ts(index),
    status: index < 2 ? "Completed" : "Running", progress: index < 2 ? 1 : 0, durationMs: 9000,
    outputs: index < 2 ? [{ url, contentType: "image/svg+xml" }] : [],
  }))
  const card = (record: ComputeJobRecord, children: ComputeJobRecord[] = []) => {
    const job = { ...normalizeChatJob(record, { jobHref: href }), children: children.map(child => normalizeChatJob(child)) }
    return <JobCard job={job} onStop={() => {}} />
  }
  const section = (title: string, entries: Array<[string, ComputeJobRecord]>, extra?: (id: string) => ComputeJobRecord[]) => (
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-primary">{title}</h2>
      <div className="grid gap-x-6 gap-y-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 440px), 1fr))" }}>
        {entries.map(([label, job]) => (
          <div key={job.id} data-gallery={job.id}>
            <div className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-muted">{label}</div>
            {card(job, extra?.(job.id) ?? [])}
          </div>
        ))}
      </div>
    </section>
  )
  return <div className="flex flex-col gap-8 p-6">
    {section("One square, every state", states, id => id === "g-r" ? batch : [])}
    {section("It adapts to the job", kinds, id => id === "k-w" ? steps : [])}
    <MediaLightbox />
  </div>
}

const root = createRoot(document.getElementById("root")!)
root.render(new URLSearchParams(location.search).has("gallery")
  ? <Gallery />
  : <WsEventContext.Provider value={ws}><App /></WsEventContext.Provider>)
