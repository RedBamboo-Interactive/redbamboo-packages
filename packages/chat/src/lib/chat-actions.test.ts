import assert from "node:assert/strict"
import { test } from "node:test"
import type { MessageBlock, MessagePart } from "../types"
import {
  artifactActionEntries,
  codeBlockActionEntries,
  codeBlockSource,
  messageActionEntries,
  messageMarkdown,
  partActionEntries,
  type HastLike,
} from "./chat-actions.ts"

const part = (type: MessagePart["type"], content: string, extra: Partial<MessagePart> = {}): MessagePart => ({ type, content, ...extra })
const block = (role: MessageBlock["role"], parts: MessagePart[]): MessageBlock => ({ id: "m1", role, parts, timestamp: "2026-10-31T10:00:00Z" })
const ids = (entries: readonly { id: string }[]) => entries.map(entry => entry.id)

test("a person's Markdown is the string the bubble renders, without machine envelopes", () => {
  const raw = '<nova-context timestamp="x">device=phone</nova-context>\nLook at `#ff0000` and **this**'
  assert.equal(messageMarkdown(block("user", [part("text", raw)])), "Look at `#ff0000` and **this**")
})

test("an assistant's Markdown is its text parts in order, past activity and blanks", () => {
  const message = block("assistant", [
    part("text", "First"),
    part("tool_use", "", { toolName: "Read" }),
    part("text", "   "),
    part("thinking", "hidden reasoning"),
    part("text", "```ts\nconst a = 1\n```"),
  ])
  assert.equal(messageMarkdown(message), "First\n\n```ts\nconst a = 1\n```")
})

test("message items: copy pair, host extras, then Info", () => {
  const calls: string[] = []
  const entries = messageActionEntries({
    markdown: "Hi",
    copyText: () => calls.push("text"),
    copyMarkdown: () => calls.push("markdown"),
    extra: [{ id: "react", label: "React" }],
    openInfo: () => calls.push("info"),
  })
  assert.deepEqual(ids(entries), ["message-copy-text", "message-copy-markdown", "message-extra-separator", "react", "message-info-separator", "message-info"])
  for (const entry of entries) if ("run" in entry) void entry.run?.({} as never)
  assert.deepEqual(calls, ["text", "markdown", "info"])
})

test("no copy items for a message with no text, no Info while it streams", () => {
  const entries = messageActionEntries({ markdown: " \n", copyText: () => {}, copyMarkdown: () => {} })
  assert.deepEqual(entries, [])
})

test("code copy is the authored source, not the highlighter's markup", () => {
  // rehype-highlight output for ```ts\nconst a = "x" // c\n```
  const pre: HastLike = {
    type: "element", tagName: "pre", children: [{
      type: "element", tagName: "code", children: [
        { type: "element", tagName: "span", children: [{ type: "text", value: "const" }] },
        { type: "text", value: " a = " },
        { type: "element", tagName: "span", children: [{ type: "text", value: '"x"' }] },
        { type: "text", value: " " },
        { type: "element", tagName: "span", children: [{ type: "text", value: "// c" }] },
        { type: "text", value: "\n" },
      ],
    }],
  }
  assert.equal(codeBlockSource(pre), 'const a = "x" // c')
  assert.equal(codeBlockSource({ type: "element", tagName: "pre", children: [{ type: "element", tagName: "code", children: [{ type: "text", value: "a\n\nb\n\n" }] }] }), "a\n\nb\n")
  assert.equal(codeBlockSource(undefined), "")
  let copied = 0
  const [copy] = codeBlockActionEntries(() => { copied++ })
  assert.equal(copy.id, "code-copy")
  if ("run" in copy) void copy.run?.({} as never)
  assert.equal(copied, 1)
})

test("square items: details always, editor and Compute only when they apply", () => {
  assert.deepEqual(ids(partActionEntries({ openDetails: () => {} })), ["part-open-details"])
  const navigated: string[] = []
  const entries = partActionEntries({ openDetails: () => {}, openFile: () => {}, jobHref: "/apps/compute/jobs?select=j1" })
  assert.deepEqual(ids(entries), ["part-open-details", "part-open-file", "part-open-job"])
  const job = entries[2]
  if ("run" in job) void job.run?.({ navigate: (to: string) => navigated.push(to) } as never)
  assert.deepEqual(navigated, ["/apps/compute/jobs?select=j1"])
})

test("artifact items follow what the row can do", () => {
  assert.deepEqual(ids(artifactActionEntries({})), [])
  const entries = artifactActionEntries({ open: () => {}, openLabel: "Play", goToMessage: () => {} })
  assert.deepEqual(ids(entries), ["artifact-open", "artifact-go-to-message"])
  assert.equal("label" in entries[0] ? entries[0].label : "", "Play")
})
