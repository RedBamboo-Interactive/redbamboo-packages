import assert from "node:assert/strict"
import test from "node:test"
import type { ChatEvent, MessageBlock } from "../types.ts"
import { rebuildBlocks, type PersistedMessage } from "./rebuild-blocks.ts"
import { SessionTranscriptPaging, isTranscriptCursorRejected, type TranscriptPageRequest } from "./session-transcript-paging.ts"
import type { TranscriptPageResponse } from "./transcript-page.ts"

// ── A deterministic transcript-page server ────────────────────────────────────────────────────

interface Stored extends PersistedMessage { id: number }

class FakeTranscriptServer {
  epoch = "epoch-1"
  records: Stored[] = []
  requests: string[] = []
  private nextId = 1000
  private gates: Array<() => void> = []
  hold = false

  /** Appends turns with these canonical sequences, in this storage order. */
  append(...sequences: number[]): void {
    for (const sequence of sequences) this.records.push(record(this.nextId++, sequence, this.epoch))
  }

  /** A rollback: the transcript continues in a new epoch from a rotation point. */
  rotate(epoch: string, ...sequences: number[]): void {
    this.epoch = epoch
    this.records = []
    this.append(...sequences)
  }

  release(): void {
    const gates = this.gates
    this.gates = []
    for (const open of gates) open()
  }

  async fetchPage(request: TranscriptPageRequest): Promise<TranscriptPageResponse> {
    this.requests.push(request.before ? `before:${request.before}` : request.after ? `after:${request.after}` : "newest")
    if (this.hold) await new Promise<void>(resolve => this.gates.push(resolve))
    const anchor = request.before ?? request.after
    let anchorId: number | null = null
    if (anchor) {
      const [epoch, id] = anchor.split("@")
      if (epoch !== this.epoch) throw Object.assign(new Error("stale"), { status: 409, code: "transcript_cursor_stale" })
      anchorId = Number(id)
    }
    let selected: Stored[]
    let hasEarlier: boolean
    let hasLater: boolean
    if (request.before) {
      const older = this.records.filter(item => item.id < anchorId!)
      selected = older.slice(-request.limit)
      hasEarlier = older.length > selected.length
      hasLater = true
    } else if (request.after) {
      const newer = this.records.filter(item => item.id > anchorId!)
      selected = newer.slice(0, request.limit)
      hasEarlier = true
      hasLater = newer.length > selected.length
    } else {
      selected = this.records.slice(-request.limit)
      hasEarlier = this.records.length > selected.length
      hasLater = false
    }
    const sequences = selected.map(item => item.sequence!).filter(sequence => sequence != null)
    return {
      session: { id: "s1", title: "Session" },
      messages: selected.map(item => ({ ...item })),
      page: {
        epoch: this.epoch,
        direction: request.before ? "before" : request.after ? "after" : "newest",
        oldestCursor: selected.length ? `${this.epoch}@${selected[0]!.id}` : (anchor ?? null),
        newestCursor: selected.length ? `${this.epoch}@${selected.at(-1)!.id}` : (anchor ?? null),
        hasEarlier,
        hasLater,
        fromSequence: sequences.length ? Math.min(...sequences) : null,
        throughSequence: sequences.length ? Math.max(...sequences) : null,
        boundaryComplete: true,
      },
    }
  }
}

function record(id: number, sequence: number, epoch: string): Stored {
  return {
    id,
    role: sequence % 2 === 0 ? "assistant" : "user",
    eventType: "text",
    content: `text-${sequence}`,
    messageUid: `turn-${sequence}`,
    timestamp: new Date(Date.UTC(2026, 10, 13, 9, 0, 0, sequence)).toISOString(),
    epoch,
    sequence,
  }
}

function live(sequence: number, epoch = "epoch-1", messageUid = `turn-${sequence}`, content = `text-${sequence}`): ChatEvent {
  return { type: "text", content, messageUid, epoch, sequence }
}

/** The host: Code's state update, reduced to its reconciliation. */
function host(server: FakeTranscriptServer, limit = 4) {
  const view: { messages: MessageBlock[]; hasEarlier: boolean; epochChanges: number; windows: number } = {
    messages: [], hasEarlier: false, epochChanges: 0, windows: 0,
  }
  const paging = new SessionTranscriptPaging({
    limit,
    fetchPage: request => server.fetchPage(request),
    onWindow: window => {
      view.windows++
      const result = paging.accumulator.commitSnapshot(window.requestId, rebuildBlocks(window.records), window.cursor)
      if (result.staleSnapshot) return
      if (result.epochChanged) view.epochChanges++
      view.messages = result.messages
      view.hasEarlier = window.hasEarlier
    },
  })
  const receive = (event: ChatEvent) => {
    const result = paging.accumulator.receiveLive(event, view.messages)
    view.messages = result.messages
    return result
  }
  return { view, paging, receive }
}

const texts = (messages: MessageBlock[]) => messages.map(message => message.parts.map(part => part.content).join("|"))

// ── The regression matrix ─────────────────────────────────────────────────────────────────────

test("cursor at the start: earlier pages load until the first record, then there is nothing before", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2, 3, 4, 5, 6, 7, 8, 9, 10)
  const { view, paging } = host(server)
  assert.equal(await paging.loadNewest(), "committed")
  assert.deepEqual(texts(view.messages), ["text-7", "text-8", "text-9", "text-10"])
  assert.equal(view.hasEarlier, true)
  assert.equal(await paging.loadEarlier(), "committed")
  assert.equal(await paging.loadEarlier(), "committed")
  assert.equal(view.hasEarlier, false)
  assert.equal(await paging.loadEarlier(), "none")
  assert.deepEqual(texts(view.messages), Array.from({ length: 10 }, (_, i) => `text-${i + 1}`))
  assert.deepEqual(server.requests, ["newest", "before:epoch-1@1006", "before:epoch-1@1002"])
})

test("a short transcript has no earlier page at all", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2)
  const { view, paging } = host(server)
  await paging.loadNewest()
  assert.equal(view.hasEarlier, false)
  assert.equal(paging.hasEarlier, false)
  assert.equal(await paging.loadEarlier(), "none")
})

test("history/live overlap: events the page covers are dropped, the ones above it replay once", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2, 3, 4, 5, 6, 7, 8)
  const { view, paging, receive } = host(server)
  // Live events 6..10 arrive while the newest page (through 8) is in flight.
  server.hold = true
  const loading = paging.loadNewest()
  await Promise.resolve()
  for (const sequence of [6, 8, 10]) receive(live(sequence))
  server.release()
  await loading
  assert.deepEqual(texts(view.messages), ["text-5", "text-6", "text-7", "text-8", "text-10"])
})

test("duplicate delivery: a repeated live event and a repeated catch-up add nothing", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2, 3, 4)
  const { view, paging, receive } = host(server)
  await paging.loadNewest()
  receive(live(6))
  receive(live(6))
  server.append(5, 6)
  await paging.catchUp()
  await paging.catchUp()
  assert.deepEqual(texts(view.messages), ["text-1", "text-2", "text-3", "text-4", "text-5", "text-6"])
})

test("paging while a turn streams: the live turn stays, once, below the earlier page", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2, 3, 4, 5, 6, 7, 8)
  const { view, paging, receive } = host(server)
  await paging.loadNewest()
  // A turn streams above the durable window: two parts of one assistant message.
  receive({ type: "text", content: "streaming", messageUid: "turn-live", epoch: "epoch-1", sequence: 9, isPartial: true })
  receive({ type: "tool_use", toolName: "Read", messageId: "call-1", messageUid: "turn-live", epoch: "epoch-1", sequence: 10 })
  const before = view.messages.find(message => message.id === "turn-live")
  assert.ok(before)
  await paging.loadEarlier()
  const liveBlocks = view.messages.filter(message => message.id === "turn-live")
  assert.equal(liveBlocks.length, 1)
  assert.deepEqual(liveBlocks[0]!.parts.map(part => part.type), before.parts.map(part => part.type))
  assert.equal(view.messages.at(-1)!.id, "turn-live")
  assert.deepEqual(texts(view.messages.slice(0, 8)), Array.from({ length: 8 }, (_, i) => `text-${i + 1}`))
})

test("a reset mid-load (session switch, reopen) drops the read in flight", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2, 3, 4, 5, 6)
  const { view, paging } = host(server)
  await paging.loadNewest()
  const windows = view.windows
  server.hold = true
  const earlier = paging.loadEarlier()
  await Promise.resolve()
  paging.reset()
  server.release()
  assert.equal(await earlier, "superseded")
  assert.equal(view.windows, windows)
  // The next read starts again at the newest page.
  server.hold = false
  assert.equal(await paging.catchUp(), "committed")
  assert.equal(server.requests.at(-1), "newest")
})

test("two sessions page independently", async () => {
  const a = new FakeTranscriptServer()
  const b = new FakeTranscriptServer()
  a.append(1, 2, 3, 4, 5, 6)
  b.append(1, 2)
  const hostA = host(a)
  const hostB = host(b)
  a.hold = true
  const loadingA = hostA.paging.loadNewest()
  await hostB.paging.loadNewest()
  a.release()
  await loadingA
  assert.equal(hostA.view.messages.length, 4)
  assert.equal(hostB.view.messages.length, 2)
  assert.equal(hostA.view.hasEarlier, true)
  assert.equal(hostB.view.hasEarlier, false)
})

test("reconnect: catch-up walks every page written while away, leaving no interior gap", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2, 3, 4)
  const { view, paging } = host(server)
  await paging.loadNewest()
  server.append(...Array.from({ length: 11 }, (_, i) => i + 5))
  assert.equal(await paging.catchUp(), "committed")
  assert.deepEqual(texts(view.messages), Array.from({ length: 15 }, (_, i) => `text-${i + 1}`))
  assert.deepEqual(server.requests.slice(1), ["after:epoch-1@1003", "after:epoch-1@1007", "after:epoch-1@1011"])
})

test("a stale cursor after a rollback restarts at the newest page of the new epoch", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2, 3, 4)
  const { view, paging } = host(server)
  await paging.loadNewest()
  server.rotate("epoch-2", 1, 2)
  assert.equal(await paging.catchUp(), "committed")
  assert.deepEqual(server.requests, ["newest", "after:epoch-1@1003", "newest"])
  assert.deepEqual(texts(view.messages), ["text-1", "text-2"])
  assert.equal(view.epochChanges, 1)
  assert.equal(isTranscriptCursorRejected({ status: 409, code: "transcript_cursor_mismatch" }), true)
  assert.equal(isTranscriptCursorRejected({ status: 409, code: "conflict" }), false)
})

test("storage order is not canonical order: inverted sequences rebuild in sequence order", async () => {
  const server = new FakeTranscriptServer()
  server.append(109, 111, 110, 112)
  const { view, paging } = host(server)
  await paging.loadNewest()
  assert.deepEqual(texts(view.messages), ["text-109", "text-110", "text-111", "text-112"])
})

test("a page the pager cannot verify fails the read and keeps the window", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2, 3, 4, 5, 6)
  const { view, paging } = host(server)
  await paging.loadNewest()
  const shown = texts(view.messages)
  const broken = new SessionTranscriptPaging({
    fetchPage: async () => ({ messages: [], page: { direction: "newest" } }),
    onWindow: () => { throw new Error("never") },
  })
  assert.equal(await broken.loadNewest(), "failed")
  assert.ok(broken.lastFailure instanceof Error)
  const original = server.fetchPage.bind(server)
  server.fetchPage = async (request) => {
    const response = await original(request)
    return { ...response, page: { ...response.page, boundaryComplete: false } }
  }
  assert.equal(await paging.loadEarlier(), "failed")
  assert.deepEqual(texts(view.messages), shown)
  assert.equal(paging.hasEarlier, true)
})

test("a burst of catch-up requests joins the one already waiting", async () => {
  const server = new FakeTranscriptServer()
  server.append(1, 2)
  const { paging } = host(server)
  server.hold = true
  const first = paging.loadNewest()
  const a = paging.catchUp()
  const b = paging.catchUp()
  assert.equal(a, b)
  server.hold = false
  server.release()
  await Promise.all([first, a])
  assert.deepEqual(server.requests, ["newest", "after:epoch-1@1001"])
})
