import React, { useMemo, useRef, useState } from "react"
import { createRoot } from "react-dom/client"
import { WsEventContext, type WsEventContextValue } from "@redbamboo/utility"
import { ChatPanel } from "../../src/components/chat-panel"
import { JobTwin } from "../../src/components/job-twin"
import { JobSummary } from "../../src/components/job-summary"
import { MediaLightbox } from "../../src/components/streaming-text"
import { useChatJobs } from "../../src/hooks/use-chat-jobs"
import { normalizeChatJob, type ChatJob, type ComputeJobRecord } from "../../src/lib/chat-jobs"
import { getPartColor } from "../../src/lib/part-colors"
import type { ChatJobsTransport } from "../../src/lib/chat-jobs-sync"
import { rebuildBlocks, type PersistedMessage } from "../../src/lib/rebuild-blocks"
import type { ActivityStatusGroup, MessagePart } from "../../src/types"
import "./fixture.css"

// Job twins fixture (89efca37; job cards before it, f6e6c083): a long conversation built through rebuildBlocks, as hosts
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
// In transcript order: the person's message, then the reply, which has no frieze.
const landedUser = record({ role: "user", eventType: "text", messageUid: "u-landed", content: "Show me what came out." }, LAUNCH + 198)
const landed = record({ role: "assistant", eventType: "text", messageUid: "a-landed",
  content: "Both done. The boss cover is the one: it reads at thumbnail size.\n\n![Boss cover](" + art("#3f8f4a", "#d4aa4f") + ")" }, LAUNCH + 200)

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

/** Every state side by side, in a frieze row like the approved mockup's section G, at 1:1 and 4x. */
function Gallery() {
  const [open, setOpen] = useState<ChatJob | null>(null)
  const base = { providerName: "ComfyUI", queuedAt: ts(0), startedAt: ts(0), capability: "image-gen", name: "Launch covers" }
  const href = (id: string) => `/apps/compute/jobs?select=${id}`
  const now = Date.now()
  const states: Array<[string, ComputeJobRecord, Partial<ChatJob>?]> = [
    ["Queued", { ...base, id: "g-q", status: "Queued", stage: "admitted" }],
    ["Starting (no real progress)", { ...base, id: "g-w", status: "Running", stage: "waiting", progress: 0, startedAt: new Date(now - 14000).toISOString() }],
    ["35%", { ...base, id: "g-35", status: "Running", stage: "executing", progress: 0.35 }],
    ["62%", { ...base, id: "g-p", status: "Running", stage: "executing", progress: 0.62 }],
    ["Needs you", { ...base, id: "g-n", status: "Running", stage: "executing" }, { state: "needs-you", progress: null }],
    ["Done", { ...base, id: "g-d", status: "Completed", durationMs: 72000, outputs: ART.map((url, i) => ({ url, contentType: "image/svg+xml", sizeBytes: i })) }],
    ["Done, one image", { ...base, id: "g-c", name: "Level map", status: "Completed", durationMs: 38000, prompt: "A top-down level map of a mossy ruin, hand-inked, warm light", outputs: [{ url: ART[2], contentType: "image/svg+xml" }] }],
    ["Failed", { ...base, id: "g-f", capability: "video-gen", name: "Trailer cut", providerName: "Wan 2.2", status: "Failed", stage: "failed", errorMessage: "CUDA out of memory while decoding frame 34", durationMs: 120000 }],
    ["Stopped", { ...base, id: "g-s", capability: "model-download", name: "Model download", status: "Cancelled", stage: "cancelled" }],
    ["Workflow, 56%", { ...base, id: "k-w", capability: "workflow", name: "Monday support digest", providerName: "RedLeaf Workflow Engine", status: "Running", progress: 0.56 }],
  ]
  const steps: ComputeJobRecord[] = ["Read inbox", "Group", "Summarize", "Send"].map((name, index) => ({
    id: `k-w-${index}`, capability: "workflow-step", name, parentJobId: "k-w", queuedAt: ts(index),
    status: index < 2 ? "Completed" : index === 2 ? "Running" : "Queued", progress: index === 2 ? 0.45 : 0, durationMs: 9000,
  }))
  const jobOf = (record: ComputeJobRecord, overrides?: Partial<ChatJob>): ChatJob => ({
    ...normalizeChatJob(record, { jobHref: href }), ...overrides,
    children: record.id === "k-w" ? steps.map(step => normalizeChatJob(step)) : [],
  })
  // A frieze's squares before the twin: thinking, a read, two shell calls, like a launching turn.
  const squares: MessagePart[] = [
    { type: "thinking", content: "" },
    { type: "tool_use", toolName: "Read", content: "" },
    { type: "tool_use", toolName: "Bash", content: "" },
    { type: "tool_use", toolName: "Bash", content: "" },
  ]
  const row = (job: ChatJob) => (
    <div className="flex flex-wrap items-center gap-[3px] py-1.5 px-0.5">
      {squares.map((part, index) => <span key={index} className="block h-2.5 w-2.5 rounded-[2px]" style={{ backgroundColor: getPartColor(part) }} />)}
      <JobTwin job={job} onOpen={() => setOpen(job)} />
    </div>
  )
  const grid = (zoom: number) => (
    <div className="grid gap-x-6 gap-y-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${zoom > 1 ? 100 : 150}px, 1fr))`, zoom }}>
      {states.map(([label, record, overrides]) => (
        <div key={record.id} data-gallery={zoom === 1 ? record.id : undefined}>
          {row(jobOf(record, overrides))}
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-text-muted">{label}</div>
        </div>
      ))}
    </div>
  )
  return <div className="flex flex-col gap-8 p-6">
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-primary">Every state, 1:1</h2>
      {grid(1)}
    </section>
    <section className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-text-primary">The same, 4x for inspection</h2>
      {grid(4)}
    </section>
    {open && <JobSummary job={open} onStop={() => {}} onClose={() => setOpen(null)} />}
    <MediaLightbox />
  </div>
}

const root = createRoot(document.getElementById("root")!)
root.render(new URLSearchParams(location.search).has("gallery")
  ? <Gallery />
  : <WsEventContext.Provider value={ws}><App /></WsEventContext.Provider>)
