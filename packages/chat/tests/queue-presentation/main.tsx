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
createRoot(document.getElementById("root")!).render(new URLSearchParams(location.search).has("events") ? <EventApp /> : new URLSearchParams(location.search).has("links") ? <LinkProbe /> : <App />)
