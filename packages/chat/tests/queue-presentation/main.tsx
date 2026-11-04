import React, { useMemo, useState } from "react"
import { createRoot } from "react-dom/client"
import { StreamingText } from "../../src/components/streaming-text"
import { ChatPanel } from "../../src/components/chat-panel"
import { rebuildBlocks } from "../../src/lib/rebuild-blocks"
import { getRemoteMessageQueueStore } from "../../src/lib/remote-message-queue-store"
import type { ChatQueueSnapshot, ChatQueueTransport, MessageBlock, SendOptions, ChatQueuedItem } from "../../src/types"

const stamp = "2026-09-12T22:00:00Z"
const test = {
  opened: [] as { filePath: string; line?: number; column?: number }[],
  submissions: [] as { text: string; options: SendOptions; resolve: (value: unknown) => void }[],
  requests: [] as ((snapshot: ChatQueueSnapshot) => void)[],
  listeners: new Set<() => void>(),
  snapshot(state: "pending" | "delivering" | "delivered"): ChatQueueSnapshot {
    return { items: this.submissions.map((s, i) => ({
      id: `server-${i}`, clientId: s.options.idempotencyKey, sessionId: "queue-test", sequence: i + 1,
      state, delivery: "after-current", displayContent: s.text, messageUid: s.options.messageUid!,
      deliveredMessageUid: state === "delivered" ? this.submissions[0].options.messageUid : undefined,
      createdAt: stamp, updatedAt: stamp, attemptCount: 1,
    })), queue: { depth: state === "delivered" ? 0 : this.submissions.length, state } }
  },
  read: () => getRemoteMessageQueueStore("queue-test").getSnapshot().queue,
  canonical: (_count?: number) => {},
  remount: () => {},
}
;(window as unknown as { queueTest: typeof test }).queueTest = test

function App() {
  const [messages, setMessages] = useState<MessageBlock[]>([])
  const [mount, setMount] = useState(0)
  const [isStreaming, setIsStreaming] = useState(false)
  const rich = new URLSearchParams(location.search).has("rich")
  const transport = useMemo<ChatQueueTransport>(() => ({
    list: () => new Promise(resolve => test.requests.push(resolve)),
    cancel: async () => { throw new Error("unused") },
    retry: async () => { throw new Error("unused") }, sendNow: async () => {},
    subscribe: listener => { test.listeners.add(listener); return () => { test.listeners.delete(listener) } },
  }), [])
  const send = (text: string, options?: SendOptions) => new Promise(resolve => {
    test.submissions.push({ text, options: options!, resolve })
    setIsStreaming(true)
  })
  test.canonical = (count = test.submissions.length) => setMessages(rebuildBlocks([{
    id: 1, role: "user", eventType: "text", timestamp: stamp, epoch: "epoch", sequence: 1,
    messageUid: test.submissions[0].options.messageUid,
    content: test.submissions.slice(0, count).map(s => s.text).join("\n\n"),
    attachmentsJson: JSON.stringify({ inputMessageUids: test.submissions.slice(0, count).map(s => s.options.messageUid),
      ...(rich ? { attachments: [{ id: "file", name: "notes.txt", kind: "file", mediaType: "text/plain", size: 5,
        downloadUrl: "data:text/plain,notes" }] } : {}) }),
  }]))
  test.remount = () => setMount(value => value + 1)
  return <div style={{ width: "100%", height: 700 }}><ChatPanel key={mount} messages={messages}
    isStreaming={isStreaming} onSend={(text, _images, options) => send(text, options)}
    onSendInput={(parts, _attachments, options) => send(parts.filter(part => part.type === "text").map(part => part.text).join("\n"), options)}
    prepareOutgoingMessage={rich ? message => ({ ...message,
      content: `<nova-context input="typed">captured</nova-context>${message.content}`,
      attachments: [{ id: "file", name: "notes.txt", kind: "file", mediaType: "text/plain", size: 5, downloadUrl: "data:text/plain,notes" }],
    }) : undefined}
    onInterrupt={() => {}} sessionId="queue-test" queueTransport={transport} persistQueue={false}/></div>
}
function LinkProbe() {
  return <StreamingText content={'[Audit](</L:/Workspaces/Nova/memory/projects/Double Message Audit 2026-09-13.md>)\n\n[Source](/T:/Projects/file.cs:12:4)\n\n[Journal](/apps/nova/journal/memory/note.md)'}
    resolveFileLink={(filePath, location) => () => { test.opened.push({ filePath, ...location }) }} />
}
const eventTest = {
  actions: [] as string[],
  state: "pending" as ChatQueuedItem["state"],
  change: (_state: ChatQueuedItem["state"]) => {},
  remount: () => {},
}
;(window as unknown as { eventQueueTest: typeof eventTest }).eventQueueTest = eventTest

function EventApp() {
  const [mount, setMount] = useState(0)
  const listeners = useMemo(() => new Set<() => void>(), [])
  const items = (): ChatQueuedItem[] => ["first", "second"].map((id, i) => ({
    id, sessionId: "event-test", sequence: i + 1, state: eventTest.state,
    delivery: "after-current", displayContent: '<nova-event source="coordination">Same looking event</nova-event>',
    messageUid: id, deliveredMessageUid: eventTest.state === "delivered" ? id : undefined,
    createdAt: stamp, updatedAt: stamp, attemptCount: 1,
    error: eventTest.state === "failed" ? { code: "test-failure", message: "Delivery failed; retry available" } : undefined,
  }))
  eventTest.change = state => { eventTest.state = state; listeners.forEach(listener => listener()) }
  eventTest.remount = () => setMount(v => v + 1)
  const transport = useMemo<ChatQueueTransport>(() => ({
    list: async () => ({ items: items(), queue: { depth: 2, state: "ready" } }),
    cancel: async id => { eventTest.actions.push("cancel:" + id); eventTest.change("cancelled"); return items().find(item => item.id === id)! },
    retry: async id => { eventTest.actions.push("retry:" + id); eventTest.change("pending"); return items().find(item => item.id === id)! },
    sendNow: async () => { eventTest.actions.push("send-now") },
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }), [])
  const messages: MessageBlock[] = [{ id: "activity", role: "assistant", timestamp: stamp, parts: [
    { type: "tool_use", toolName: "Read", content: "Keep this tool" },
    ...["first", "second"].map(messageUid => ({ type: "tool_use" as const, toolName: "event:coordination",
      messageUid, content: "Same looking event", toolInput: JSON.stringify({ event: "Same looking event", timestamp: stamp }) })),
  ] }]
  return <ChatPanel key={mount} messages={messages} isStreaming sessionId="event-test" queueTransport={transport} persistQueue={false} />
}

const waitTest = {
  actions: [] as string[],
  states: {} as Record<string, ChatQueuedItem["state"] | undefined>,
  steerSupport: true,
  streaming: true,
  placed: false,
  apply: (_change: Partial<{ states: Record<string, ChatQueuedItem["state"] | undefined>; streaming: boolean; placed: boolean }>) => {},
  remount: () => {},
}
;(window as unknown as { waitTest: typeof waitTest }).waitTest = waitTest

/** A running turn with a note and a machine event that are queued, then delivered, then placed. */
function WaitApp() {
  const [, render] = useState(0)
  const [mount, setMount] = useState(0)
  const listeners = useMemo(() => new Set<() => void>(), [])
  const noSteerCall = new URLSearchParams(location.search).has("nosteercall")
  const items = (): ChatQueuedItem[] => Object.entries(waitTest.states).flatMap(([uid, state], index) => state ? [{
    id: `q-${uid}`, sessionId: "wait-test", sequence: index + 1, state,
    delivery: "after-current" as const, displayContent: "<nova-event source=\"x\">raw frame</nova-event>", messageUid: uid,
    deliveredMessageUid: state === "delivered" ? uid : undefined,
    createdAt: stamp, updatedAt: stamp, completedAt: state === "delivered" ? stamp : undefined, attemptCount: 0,
  }] : [])
  waitTest.apply = change => {
    Object.assign(waitTest, change)
    render(value => value + 1)
    listeners.forEach(listener => listener())
  }
  waitTest.remount = () => setMount(value => value + 1)
  const transport = useMemo<ChatQueueTransport>(() => ({
    list: async () => ({ items: items(), queue: { depth: items().length, state: "waiting_for_session", blockedReason: "active_turn" } }),
    cancel: async id => { waitTest.actions.push("cancel:" + id); return items()[0]! },
    retry: async id => { waitTest.actions.push("retry:" + id); return items()[0]! },
    sendNow: async () => { waitTest.actions.push("send-now") },
    ...(noSteerCall ? {} : { steer: async (id: string) => { waitTest.actions.push("steer:" + id) } }),
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener) } },
  }), [])
  const part = (uid: string) => ({ type: "tool_use" as const, toolName: uid === "note" ? "event:agent-note" : "event:weather",
    messageUid: uid, content: uid, inputPlaced: waitTest.placed || undefined,
    toolInput: JSON.stringify({ event: uid, label: uid, timestamp: stamp }) })
  const events = (timestamp: string): MessageBlock[] => [
    { id: "event-note", role: "assistant", timestamp, parts: [part("note")] },
    { id: "event-dot", role: "assistant", timestamp, parts: [part("dot")] },
  ]
  const before: MessageBlock = { id: "turn", role: "assistant", timestamp: "2026-09-12T22:00:00Z", parts: [{ type: "text", content: "Text before" }], metadata: { messageUid: "turn" } }
  const after: MessageBlock = { id: "turn:segment:1", role: "assistant", timestamp: "2026-09-12T22:02:00Z", parts: [{ type: "text", content: "Text after" }], metadata: { messageUid: "turn" } }
  const messages = [before, ...events("2026-09-12T22:01:00Z"), after]
  return <div style={{ width: "100%", height: 700 }}><ChatPanel key={mount} messages={messages} isStreaming={waitTest.streaming}
    supportsSteering={waitTest.steerSupport} sessionId="wait-test" queueTransport={transport} persistQueue={false} queuedEventsWait
    eventRows={{ isRow: candidate => candidate.toolName === "event:agent-note",
      render: (candidate, { queueStatus, waiting }) => <div data-slot="test-note-row" data-has-status={!!queueStatus} data-waiting={!!waiting}>Nova, from elsewhere: {candidate.content}</div> }} />
  </div>
}

createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).has("wait") ? <WaitApp /> : new URLSearchParams(location.search).has("events") ? <EventApp /> :new URLSearchParams(location.search).has("links") ? <LinkProbe /> : <App />)
