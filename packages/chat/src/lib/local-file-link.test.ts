import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import Markdown from "react-markdown"
import { parseLocalFileLink } from "./local-file-link.ts"

test("parses a Windows file link with a line suffix", () => {
  assert.deepEqual(parseLocalFileLink("T:/Projects/nova/src/MessagePipeline.cs:348"), {
    filePath: "T:/Projects/nova/src/MessagePipeline.cs",
    line: 348,
    column: undefined,
  })
})

test("parses file URLs and encoded spaces", () => {
  assert.deepEqual(parseLocalFileLink("file:///L:/Workspaces/Nova/memory/My%20note.md#L12:4"), {
    filePath: "L:/Workspaces/Nova/memory/My note.md",
    line: 12,
    column: 4,
  })
})

test("does not claim web or relative links", () => {
  assert.equal(parseLocalFileLink("https://example.com/file.cs:12"), null)
  assert.equal(parseLocalFileLink("docs/file.md:12"), null)
})

test("recovers the line suffix after the real Markdown parser", () => {
  const parsed: unknown[] = []
  renderToStaticMarkup(createElement(
    Markdown,
    {
      urlTransform: (url: string) => url,
      components: {
        a: ({ href }: { href?: string }) => {
          parsed.push(parseLocalFileLink(href))
          return null
        },
      },
    },
    String.raw`[MessagePipeline.cs](T:\Projects\nova\src\MessagePipeline.cs:348)`,
  ))

  assert.deepEqual(parsed, [{
    filePath: "T:\\Projects\\nova\\src\\MessagePipeline.cs",
    line: 348,
    column: undefined,
  }])
})
