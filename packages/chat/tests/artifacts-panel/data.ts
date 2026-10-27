import type { Artifact, ArtifactKind, ArtifactLoadParams, ArtifactOrigin, ArtifactPage } from "../../src/lib/artifacts"

// A realistic synthetic conversation: every artifact kind and every origin.
// Timestamps are relative to "now" so the relative-time labels stay stable.

const NOW = Date.now()
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString()

interface Seed {
  key: string
  kind: ArtifactKind
  origin: ArtifactOrigin
  target: string
  ago: number
  uid?: string
  title?: string
  name?: string
  size?: number
  mediaType?: string
  entity?: { typeSlug: string; id: string }
  file?: { path: string; line?: number }
  internal?: boolean
  occurrences?: number
}

function make(seed: Seed): Artifact {
  // Newer artifacts get a higher sequence, so panel order is recency order.
  const seq = 20_000 - Math.round(seed.ago * 10)
  const occurrence = { messageUid: seed.uid ?? `msg-${seq}`, recordId: seq * 3, sequence: seq, timestamp: minutesAgo(seed.ago) }
  return {
    key: seed.key,
    kind: seed.kind,
    origin: seed.origin,
    role: seed.origin === "user-text" || seed.origin === "user-attachment" || seed.origin === "voice" ? "user" : "assistant",
    target: seed.target,
    title: seed.title ?? null,
    mediaType: seed.mediaType ?? null,
    name: seed.name ?? null,
    size: seed.size ?? null,
    entity: seed.entity ?? null,
    file: seed.file ? { path: seed.file.path, line: seed.file.line ?? null } : null,
    payloadRef: null,
    internal: seed.internal ?? null,
    first: occurrence,
    last: occurrence,
    occurrences: seed.occurrences ?? 1,
  }
}

const asset = (id: string, extra: Partial<Seed> & { ago: number; title?: string }): Seed => ({
  key: `asset:${id}`, kind: "image", origin: "assistant-text", target: `/api/assets/${id}`, mediaType: "image/png", ...extra,
})

export const SEEDS: Seed[] = [
  // Images
  asset("9df7aa11.png", { ago: 4, title: "Sunset over the harbour", uid: "msg-sunset" }),
  asset("b03c5e72.png", { ago: 9, title: "Moodboard, warm palette" }),
  { key: "payload:7002", kind: "image", origin: "assistant-image", target: "/api/apps/nova/discussions/d1/messages/7002/output", ago: 16, title: "Generated: lantern festival", mediaType: "image/png" },
  asset("c41e90ab.png", { ago: 21, title: "Character sheet" }),
  { key: "url:https://cdn.example.com/cat.PNG", kind: "image", origin: "user-text", target: "https://cdn.example.com/cat.PNG", ago: 33, title: "Reference photo", mediaType: "image/png" },
  { key: "attachment:a1", kind: "image", origin: "user-attachment", target: "/ai-session/input-attachments/a1", ago: 41, name: "photo.jpg", size: 2_411_000, mediaType: "image/jpeg" },
  asset("d52fa1c3.png", { ago: 55, title: "Logo variants" }),
  asset("e63b02d4.png", { ago: 70, title: "Level one concept" }),
  asset("gone0001.png", { ago: 95, title: "Deleted render" }),
  { key: "file:C:/Shots/one.png", kind: "image", origin: "assistant-text", target: "C:/Shots/one.png", ago: 120, title: "Screenshot from Code", file: { path: "C:/Shots/one.png" }, mediaType: "image/png" },
  asset("f74c13e5.png", { ago: 180, title: "Texture study" }),
  asset("085d24f6.png", { ago: 260, title: "Colour keys" }),
  asset("196e3507.png", { ago: 340, title: "Sketch, rough" }),
  // Videos
  { key: "asset:clip0001.mp4", kind: "video", origin: "assistant-text", target: "/api/assets/clip0001.mp4", ago: 12, title: "Camera fly-through", mediaType: "video/mp4" },
  { key: "url:https://v.example.com/demo.webm", kind: "video", origin: "user-text", target: "https://v.example.com/demo.webm", ago: 150, title: "Demo recording", mediaType: "video/webm" },
  // Audio
  { key: "asset:voice001.mp3", kind: "audio", origin: "voice", target: "/api/assets/voice001.mp3", ago: 8, title: "Voice message", mediaType: "audio/mpeg" },
  { key: "url:https://audio.example.com/theme.mp3", kind: "audio", origin: "assistant-text", target: "https://audio.example.com/theme.mp3", ago: 200, title: "Theme draft", mediaType: "audio/mpeg" },
  // Documents
  { key: "attachment:a2", kind: "document", origin: "user-attachment", target: "/ai-session/input-attachments/a2", ago: 6, name: "Quarterly report.pdf", size: 482_000, mediaType: "application/pdf" },
  { key: "file:C:/Projects/atlas/docs/design.md", kind: "document", origin: "tool-write", target: "C:/Projects/atlas/docs/design.md", ago: 14, file: { path: "C:/Projects/atlas/docs/design.md" } },
  { key: "file:C:/Projects/atlas/src/main.ts", kind: "document", origin: "assistant-text", target: "C:/Projects/atlas/src/main.ts", ago: 30, title: "entry point", file: { path: "C:/Projects/atlas/src/main.ts", line: 42 } },
  { key: "asset:notes0001.json", kind: "document", origin: "assistant-text", target: "/api/assets/notes0001.json", ago: 75, title: "export", mediaType: "application/json" },
  { key: "url:https://example.com/files/spec.zip", kind: "document", origin: "user-text", target: "https://example.com/files/spec.zip", ago: 210, title: "spec bundle" },
  { key: "file:C:/Projects/atlas/plans/migration.md", kind: "document", origin: "tool-write", target: "C:/Projects/atlas/plans/migration.md", ago: 400, file: { path: "C:/Projects/atlas/plans/migration.md" } },
  // Links
  { key: "url:https://react.dev/reference/react/useSyncExternalStore", kind: "link", origin: "assistant-text", target: "https://react.dev/reference/react/useSyncExternalStore", ago: 5, title: "useSyncExternalStore reference" },
  { key: "url:https://github.com/redbamboo/packages/pull/118", kind: "link", origin: "user-text", target: "https://github.com/redbamboo/packages/pull/118", ago: 45, title: "Artifacts panel PR" },
  { key: "url:https://example.org/blog/post-with-a-rather-long-title-that-must-truncate-cleanly", kind: "link", origin: "assistant-text", target: "https://example.org/blog/post-with-a-rather-long-title-that-must-truncate-cleanly", ago: 90 },
  { key: "url:/apps/nova", kind: "link", origin: "assistant-text", target: "/apps/nova?discussion=77", ago: 60, title: "Nova discussion 77", internal: true },
  { key: "url:/apps/codered", kind: "link", origin: "assistant-text", target: "/apps/codered", ago: 240, title: "Code", internal: true },
  // Entities
  { key: "entity:page/abc-1", kind: "entity", origin: "assistant-text", target: "redleaf://page/abc-1", ago: 7, title: "Release checklist", entity: { typeSlug: "page", id: "abc-1" } },
  { key: "entity:person/p2", kind: "entity", origin: "assistant-text", target: "redleaf://person/p2", ago: 25, title: "Juju", entity: { typeSlug: "person", id: "p2" } },
  { key: "entity:task/t3", kind: "entity", origin: "user-text", target: "/database/entities/task/t3", ago: 80, title: "Wire go-to-message", entity: { typeSlug: "task", id: "t3" } },
  { key: "entity:agent/nova", kind: "entity", origin: "assistant-text", target: "redleaf://agent/nova", ago: 130, title: "Nova", entity: { typeSlug: "agent", id: "nova" } },
  { key: "entity:quality-mode/deep", kind: "entity", origin: "assistant-text", target: "redleaf://quality-mode/deep", ago: 300, title: "Deep (Codex)", entity: { typeSlug: "quality-mode", id: "deep" } },
]

export function buildArtifacts(): Artifact[] {
  return SEEDS.map(make)
}

/** An in-memory stand-in for `GET .../artifacts`: keyset-ish paging, deltas and epochs. */
export class FakeArtifactServer {
  items: Artifact[]
  epoch = "epoch-1"
  requests: ArtifactLoadParams[] = []
  failNext = 0
  maxLimit = 500

  constructor(items: Artifact[] = buildArtifacts()) {
    this.items = items
  }

  get throughSequence(): number {
    return this.items.reduce((max, item) => Math.max(max, item.last.sequence), 0)
  }

  add(item: Artifact): void {
    this.items = [item, ...this.items.filter(existing => existing.key !== item.key)]
  }

  clear(): void {
    this.items = []
    this.epoch = `epoch-${Number(this.epoch.split("-")[1]) + 1}`
  }

  load = async (params: ArtifactLoadParams): Promise<ArtifactPage> => {
    this.requests.push(params)
    await new Promise(resolve => setTimeout(resolve, 60))
    if (this.failNext > 0) { this.failNext--; throw new Error("The artifact service is unreachable") }
    const sorted = [...this.items]
      .filter(item => params.sinceSequence == null || item.last.sequence > params.sinceSequence)
      .sort((a, b) => b.last.sequence - a.last.sequence || b.last.recordId - a.last.recordId || (a.key < b.key ? -1 : 1))
    const limit = Math.min(params.limit ?? 200, this.maxLimit)
    const start = params.cursor ? Number(params.cursor) : 0
    const slice = sorted.slice(start, start + limit)
    const next = start + limit < sorted.length ? String(start + limit) : null
    return {
      sessionId: "fixture-session",
      epoch: this.epoch,
      throughSequence: this.throughSequence,
      extractorVersion: 1,
      items: slice,
      page: { nextCursor: next },
    }
  }
}

export { make as makeArtifact }
export type { Seed }
