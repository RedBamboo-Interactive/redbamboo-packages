# @redbamboo/chat

Streaming chat UI with adapter-based backend. Used by CodeRed, Nova (RedMatter CMS), and RedCompute.

## Installation

```bash
pnpm add @redbamboo/chat @redbamboo/ui
```

## Usage

Implement the `ChatBackend` adapter for your app's API:

```typescript
import type { ChatBackend, ChatEvent, ChatMessage } from '@redbamboo/chat'

const myBackend: ChatBackend = {
  async sendMessage(text: string) {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    const { session_id } = await res.json()
    return { sessionId: session_id }
  },

  subscribe(sessionId: string, onEvent: (e: ChatEvent) => void) {
    const es = new EventSource(`/api/sessions/${sessionId}/stream`)
    es.onmessage = (e) => onEvent(JSON.parse(e.data))
    return () => es.close()
  },

  async getHistory(limit = 50) {
    const res = await fetch(`/api/chat?limit=${limit}`)
    const { messages } = await res.json()
    return messages
  },

  async reset() {
    await fetch('/api/chat/reset', { method: 'POST' })
  },
}
```

Then render the chat panel:

```tsx
import { ChatPanel } from '@redbamboo/chat'

function App() {
  return <ChatPanel backend={myBackend} placeholder="Ask anything..." />
}
```

## Architecture

```
Your App
  └── ChatPanel (from @redbamboo/chat)
        ├── MessageList — renders chat history + live stream
        ├── Composer — input + send button
        ├── MarkdownRenderer — renders assistant markdown
        ├── ThinkingBlock — collapsible thinking display
        └── ToolCallBlock — tool use/result display

Your App provides: ChatBackend adapter
Package provides: all UI + streaming logic
```

## Types

- `ChatBackend` — adapter interface your app implements
- `ChatMessage` — persisted message (id, role, content, timestamp)
- `ChatEvent` — streaming event (type, content, thinking, tool_calls_json)
- `ChatPanelProps` — top-level component props

## License

MIT
