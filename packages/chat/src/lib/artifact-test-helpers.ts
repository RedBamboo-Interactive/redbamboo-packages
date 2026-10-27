import type { Artifact } from "./artifacts.ts"

// Shared by the node:test files (this module has no tests of its own, so the
// `src/**/*.test.ts` glob does not run it).
let counter = 0

export function artifact(overrides: Partial<Artifact> & { sequence?: number; recordId?: number } = {}): Artifact {
  const { sequence = ++counter, recordId = sequence, ...rest } = overrides
  const occurrence = { messageUid: `m${sequence}`, recordId, sequence, timestamp: "2026-10-27T10:00:00Z" }
  return {
    key: `url:https://example.com/${sequence}`,
    kind: "link",
    origin: "assistant-text",
    role: "assistant",
    target: `https://example.com/${sequence}`,
    title: null,
    mediaType: null,
    name: null,
    size: null,
    entity: null,
    file: null,
    payloadRef: null,
    internal: null,
    first: occurrence,
    last: occurrence,
    occurrences: 1,
    ...rest,
  }
}
