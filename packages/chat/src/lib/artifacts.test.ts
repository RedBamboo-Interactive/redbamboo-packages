import assert from "node:assert/strict"
import { test } from "node:test"
import {
  artifactDisplayName,
  artifactLinkHref,
  artifactLinkTitle,
  artifactOriginLabel,
  artifactThumbnailSrc,
  defaultResolveArtifactTarget,
  documentIcon,
  formatRelativeTime,
  groupArtifacts,
  mergeArtifacts,
  sortArtifacts,
  visibleArtifacts,
} from "./artifacts.ts"
import { artifact } from "./artifact-test-helpers.ts"

test("sorts by last sequence desc, then record id desc, then key", () => {
  const a = artifact({ key: "b", sequence: 5, recordId: 9 })
  const b = artifact({ key: "a", sequence: 5, recordId: 9 })
  const c = artifact({ key: "c", sequence: 5, recordId: 10 })
  const d = artifact({ key: "d", sequence: 7, recordId: 1 })
  assert.deepEqual(sortArtifacts([a, b, c, d]).map(item => item.key), ["d", "c", "a", "b"])
})

test("a delta that repeats a held key updates it and never duplicates", () => {
  const history = [artifact({ key: "k1", sequence: 1 }), artifact({ key: "k2", sequence: 2 })]
  const delta = [
    artifact({ key: "k1", sequence: 9, occurrences: 2 }),
    artifact({ key: "k3", sequence: 8 }),
  ]
  const merged = mergeArtifacts(history, delta)
  assert.deepEqual(merged.map(item => item.key), ["k1", "k3", "k2"])
  assert.equal(merged.find(item => item.key === "k1")!.occurrences, 2)
  // Replaying the same delta (history/live overlap) changes nothing.
  assert.deepEqual(mergeArtifacts(merged, delta), merged)
})

test("merging does not mutate its inputs", () => {
  const held = [artifact({ key: "k1", sequence: 1 })]
  const snapshot = JSON.stringify(held)
  mergeArtifacts(held, [artifact({ key: "k2", sequence: 2 })])
  assert.equal(JSON.stringify(held), snapshot)
})

test("hides an artifact only when its emitted origin is hidden", () => {
  const items = [
    artifact({ key: "w", origin: "tool-write", kind: "document" }),
    artifact({ key: "t", origin: "assistant-text", kind: "document" }),
  ]
  assert.deepEqual(visibleArtifacts(items).map(item => item.key), ["w", "t"])
  assert.deepEqual(visibleArtifacts(items, ["tool-write"]).map(item => item.key), ["t"])
  assert.deepEqual(visibleArtifacts(items, []).map(item => item.key), ["w", "t"])
})

test("groups audio, video and images under Media in panel order", () => {
  const items = [
    artifact({ key: "i", kind: "image" }), artifact({ key: "d", kind: "document" }),
    artifact({ key: "a", kind: "audio" }), artifact({ key: "v", kind: "video" }),
    artifact({ key: "l", kind: "link" }), artifact({ key: "e", kind: "entity" }),
  ]
  const groups = groupArtifacts(items)
  assert.deepEqual(groups.media.map(item => item.key), ["i", "a", "v"])
  assert.deepEqual(groups.documents.map(item => item.key), ["d"])
  assert.deepEqual(groups.links.map(item => item.key), ["l"])
  assert.deepEqual(groups.entities.map(item => item.key), ["e"])
})

test("display name falls back name, title, then basename of file path or target", () => {
  assert.equal(artifactDisplayName(artifact({ name: "report.pdf", title: "T" })), "report.pdf")
  assert.equal(artifactDisplayName(artifact({ title: "My title" })), "My title")
  assert.equal(artifactDisplayName(artifact({ file: { path: "C:\\Projects\\x\\README.md", line: 3 }, target: "C:/Projects/x/README.md" })), "README.md")
  assert.equal(artifactDisplayName(artifact({ target: "/api/assets/rep%20ort.pdf?x=1" })), "rep ort.pdf")
})

test("origin labels", () => {
  assert.equal(artifactOriginLabel("tool-write"), "Created")
  assert.equal(artifactOriginLabel("user-attachment"), "Attached")
  assert.equal(artifactOriginLabel("user-text"), "Shared")
  assert.equal(artifactOriginLabel("assistant-text"), "Linked")
})

test("default target resolver passes http(s) and /api paths only", () => {
  assert.equal(defaultResolveArtifactTarget(artifact({ target: "https://a.example/x" })), "https://a.example/x")
  assert.equal(defaultResolveArtifactTarget(artifact({ target: "/api/assets/a.png" })), "/api/assets/a.png")
  assert.equal(defaultResolveArtifactTarget(artifact({ target: "/ai-session/input-attachments/a1" })), null)
  assert.equal(defaultResolveArtifactTarget(artifact({ target: "C:/Work/a.ts" })), null)
  assert.equal(defaultResolveArtifactTarget(artifact({ target: "redleaf://page/abc" })), null)
  assert.equal(defaultResolveArtifactTarget(artifact({ target: "//evil.example/x" })), null)
})

test("link hrefs are http(s) or same-origin paths, never a script scheme", () => {
  assert.equal(artifactLinkHref(artifact({ target: "/apps/nova" })), "/apps/nova")
  assert.equal(artifactLinkHref(artifact({ target: "https://a.example/" })), "https://a.example/")
  assert.equal(artifactLinkHref(artifact({ target: "javascript:alert(1)" })), null)
  assert.equal(artifactLinkHref(artifact({ target: "//evil.example" })), null)
})

test("link titles prefer the author text, then the path, then the host", () => {
  assert.equal(artifactLinkTitle(artifact({ title: "Docs", target: "https://example.com/docs" })), "Docs")
  assert.equal(artifactLinkTitle(artifact({ title: null, target: "https://example.com/docs/a?b=1" })), "/docs/a?b=1")
  assert.equal(artifactLinkTitle(artifact({ title: null, target: "https://example.com/" })), "example.com")
})

test("asset images use the 256 px thumbnail route; other images do not", () => {
  assert.equal(artifactThumbnailSrc(artifact({ kind: "image", key: "asset:9df7.png" })), "/api/assets/9df7.png/thumbnail?w=256")
  assert.equal(artifactThumbnailSrc(artifact({ kind: "image", key: "url:https://x/y.png" })), null)
  assert.equal(artifactThumbnailSrc(artifact({ kind: "video", key: "asset:c1.mp4" })), null)
})

test("relative time", () => {
  const now = Date.parse("2026-10-27T12:00:00Z")
  assert.equal(formatRelativeTime("2026-10-27T11:59:50Z", now), "just now")
  assert.equal(formatRelativeTime("2026-10-27T11:55:00Z", now), "5m ago")
  assert.equal(formatRelativeTime("2026-10-27T09:00:00Z", now), "3h ago")
  assert.equal(formatRelativeTime("2026-10-25T12:00:00Z", now), "2d ago")
  assert.equal(formatRelativeTime("not a date", now), "")
})

test("document icons follow the extension", () => {
  assert.equal(documentIcon(artifact({ name: "a.pdf" })), "ph-file-pdf")
  assert.equal(documentIcon(artifact({ name: "a.md" })), "ph-file-text")
  assert.equal(documentIcon(artifact({ file: { path: "C:/x/a.ts", line: null } })), "ph-file-code")
  assert.equal(documentIcon(artifact({ target: "/api/redleaf-asset/f9" })), "ph-file")
})
