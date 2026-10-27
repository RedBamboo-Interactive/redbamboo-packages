import type { TranscriptPayloadRef } from "../types"

// Types mirror the RedCompute `GET /ai-session/sessions/{id}/artifacts` JSON
// exactly (SessionArtifactModels.cs). Absent optional fields arrive as null.

export type ArtifactKind = "image" | "video" | "audio" | "document" | "link" | "entity"

export type ArtifactOrigin =
  | "user-text"
  | "assistant-text"
  | "user-attachment"
  | "assistant-image"
  | "voice"
  | "tool-write"

export const ARTIFACT_KINDS: readonly ArtifactKind[] = ["image", "video", "audio", "document", "link", "entity"]
export const ARTIFACT_ORIGINS: readonly ArtifactOrigin[] = [
  "user-text", "assistant-text", "user-attachment", "assistant-image", "voice", "tool-write",
]

export interface ArtifactOccurrence {
  messageUid: string | null
  recordId: number
  sequence: number
  timestamp: string
}

export interface ArtifactEntityRef {
  typeSlug: string
  id: string
}

export interface ArtifactFileRef {
  path: string
  line: number | null
}

export interface Artifact {
  /** Stable dedup key, for example `asset:9df7.png`. */
  key: string
  kind: ArtifactKind
  origin: ArtifactOrigin
  role: string
  /** URL, path, or `redleaf://` href; never base64. */
  target: string
  title: string | null
  mediaType: string | null
  name: string | null
  size: number | null
  entity: ArtifactEntityRef | null
  file: ArtifactFileRef | null
  payloadRef: TranscriptPayloadRef | null
  internal: boolean | null
  first: ArtifactOccurrence
  last: ArtifactOccurrence
  occurrences: number
}

export interface ArtifactPage {
  sessionId: string
  epoch: string
  throughSequence: number
  extractorVersion: number
  items: Artifact[]
  page: { nextCursor: string | null }
}

export interface ArtifactLoadParams {
  sinceSequence?: number
  cursor?: string
  limit?: number
  origins?: ArtifactOrigin[]
}

export type ArtifactLoader = (params: ArtifactLoadParams) => Promise<ArtifactPage>

/** Newest last occurrence first; ties break on record id, then key, so the order is total and stable. */
export function compareArtifacts(a: Artifact, b: Artifact): number {
  if (a.last.sequence !== b.last.sequence) return b.last.sequence - a.last.sequence
  if (a.last.recordId !== b.last.recordId) return b.last.recordId - a.last.recordId
  return a.key < b.key ? -1 : a.key > b.key ? 1 : 0
}

export function sortArtifacts(items: readonly Artifact[]): Artifact[] {
  return [...items].sort(compareArtifacts)
}

/**
 * Fold a page (initial or delta) into the held list. A key that is already
 * held is replaced, a new key is inserted, nothing is ever duplicated, so a
 * delta that overlaps history is idempotent. Returns a freshly sorted array.
 */
export function mergeArtifacts(existing: readonly Artifact[], incoming: readonly Artifact[]): Artifact[] {
  if (incoming.length === 0) return sortArtifacts(existing)
  const byKey = new Map<string, Artifact>()
  for (const item of existing) byKey.set(item.key, item)
  for (const item of incoming) byKey.set(item.key, item)
  return sortArtifacts([...byKey.values()])
}

// --- Presentation helpers -------------------------------------------------

export type ArtifactTab = "media" | "documents" | "links" | "entities"
export const ARTIFACT_TABS: readonly ArtifactTab[] = ["media", "documents", "links", "entities"]
export const ARTIFACT_TAB_LABELS: Record<ArtifactTab, string> = {
  media: "Media",
  documents: "Documents",
  links: "Links",
  entities: "Entities",
}

export function artifactTab(kind: ArtifactKind): ArtifactTab {
  switch (kind) {
    case "image":
    case "video":
    case "audio":
      return "media"
    case "document":
      return "documents"
    case "link":
      return "links"
    case "entity":
      return "entities"
  }
}

/** An artifact is hidden only when its emitted origin is hidden. */
export function visibleArtifacts(items: readonly Artifact[], hiddenOrigins?: readonly ArtifactOrigin[]): Artifact[] {
  if (!hiddenOrigins?.length) return items.slice()
  const hidden = new Set<ArtifactOrigin>(hiddenOrigins)
  return items.filter(item => !hidden.has(item.origin))
}

export type ArtifactGroups = Record<ArtifactTab, Artifact[]>

/** Split already-visible artifacts into the panel tabs, keeping panel (newest-first) order. */
export function groupArtifacts(items: readonly Artifact[]): ArtifactGroups {
  const groups: ArtifactGroups = { media: [], documents: [], links: [], entities: [] }
  for (const item of items) groups[artifactTab(item.kind)].push(item)
  return groups
}

const ORIGIN_LABELS: Record<ArtifactOrigin, string> = {
  "tool-write": "Created",
  "user-attachment": "Attached",
  "user-text": "Shared",
  "assistant-text": "Linked",
  "assistant-image": "Generated",
  voice: "Recorded",
}

export function artifactOriginLabel(origin: ArtifactOrigin): string {
  return ORIGIN_LABELS[origin] ?? "Shared"
}

function lastSegment(value: string): string {
  const clean = value.split(/[?#]/)[0].replace(/\\/g, "/").replace(/\/+$/, "")
  const segment = clean.slice(clean.lastIndexOf("/") + 1)
  try {
    return decodeURIComponent(segment)
  } catch {
    return segment
  }
}

/** `name ?? title ?? basename(file.path ?? target)` */
export function artifactDisplayName(artifact: Artifact): string {
  return artifact.name?.trim()
    || artifact.title?.trim()
    || lastSegment(artifact.file?.path ?? artifact.target)
    || artifact.target
}

/** Hostname for an http(s) link; the path for an internal one. */
export function artifactLinkDomain(artifact: Artifact): string {
  if (/^https?:\/\//i.test(artifact.target)) {
    try {
      return new URL(artifact.target).hostname.replace(/^www\./i, "")
    } catch {
      return artifact.target
    }
  }
  return artifact.target
}

/** Title when the author gave one, otherwise the path (or host-relative target) of the link. */
export function artifactLinkTitle(artifact: Artifact): string {
  const title = artifact.title?.trim()
  if (title && title !== artifact.target) return title
  if (/^https?:\/\//i.test(artifact.target)) {
    try {
      const url = new URL(artifact.target)
      const path = `${url.pathname}${url.search}`.replace(/\/$/, "")
      return path && path !== "/" ? path : url.hostname
    } catch {
      return artifact.target
    }
  }
  return artifact.target
}

/** Default host target resolver: http(s) and relative `/api/...` pass through, anything else is unreachable. */
export function defaultResolveArtifactTarget(artifact: Artifact): string | null {
  const target = artifact.target
  if (/^https?:\/\//i.test(target)) return target
  if (target.startsWith("/api/") && !target.startsWith("//")) return target
  return null
}

/** Browser-safe href for a link artifact: the host's mapping, else http(s) or a same-origin path. */
export function artifactLinkHref(artifact: Artifact, resolveTarget?: (artifact: Artifact) => string | null): string | null {
  const resolved = resolveTarget ? resolveTarget(artifact) : defaultResolveArtifactTarget(artifact)
  const candidate = resolved ?? artifact.target
  if (/^https?:\/\//i.test(candidate)) return candidate
  if (candidate.startsWith("/") && !candidate.startsWith("//")) return candidate
  return null
}

/** RedLeaf asset id for a deduplicated asset artifact (`asset:<id>`), else null. */
export function artifactAssetId(artifact: Artifact): string | null {
  return artifact.key.startsWith("asset:") ? artifact.key.slice("asset:".length) || null : null
}

/** Thumbnail route for a RedLeaf asset image (`/api/assets/<id>/thumbnail?w=256`). */
export function artifactThumbnailSrc(artifact: Artifact, width = 256): string | null {
  if (artifact.kind !== "image") return null
  const id = artifactAssetId(artifact)
  return id ? `/api/assets/${encodeURIComponent(id)}/thumbnail?w=${width}` : null
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** Compact relative time ("just now", "5m ago", "3h ago", "2d ago", then a short date). */
export function formatRelativeTime(timestamp: string, now: number = Date.now()): string {
  const time = Date.parse(timestamp)
  if (!Number.isFinite(time)) return ""
  const delta = Math.max(0, now - time)
  if (delta < MINUTE) return "just now"
  if (delta < HOUR) return `${Math.floor(delta / MINUTE)}m ago`
  if (delta < DAY) return `${Math.floor(delta / HOUR)}h ago`
  if (delta < 7 * DAY) return `${Math.floor(delta / DAY)}d ago`
  const date = new Date(time)
  const sameYear = date.getFullYear() === new Date(now).getFullYear()
  return date.toLocaleDateString(undefined, sameYear
    ? { month: "short", day: "numeric" }
    : { year: "numeric", month: "short", day: "numeric" })
}

export function formatByteSize(size: number | null | undefined): string {
  if (size == null || !Number.isFinite(size) || size < 0) return ""
  if (size < 1024) return `${size} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(size < 10 * 1024 ? 1 : 0)} KB`
  return `${(size / (1024 * 1024)).toFixed(size < 10 * 1024 * 1024 ? 1 : 0)} MB`
}

/** Phosphor icon name (no `ph-bold` prefix) for a document row, chosen by file extension. */
export function documentIcon(artifact: Artifact): string {
  const name = (artifact.name ?? artifact.file?.path ?? artifact.target).split(/[?#]/)[0].toLowerCase()
  const ext = name.slice(name.lastIndexOf(".") + 1)
  if (name.lastIndexOf(".") < 0) return "ph-file"
  if (["pdf"].includes(ext)) return "ph-file-pdf"
  if (["md", "markdown", "txt", "rtf", "doc", "docx", "odt"].includes(ext)) return "ph-file-text"
  if (["zip", "7z", "rar", "tar", "gz", "tgz"].includes(ext)) return "ph-file-zip"
  if (["csv", "xls", "xlsx", "tsv", "ods"].includes(ext)) return "ph-file-csv"
  if (["json", "yaml", "yml", "toml", "xml", "ini"].includes(ext)) return "ph-brackets-curly"
  if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "cs", "py", "rs", "go", "java", "cpp", "c", "h", "sh", "ps1", "html", "css", "sql"].includes(ext)) return "ph-file-code"
  return "ph-file"
}
