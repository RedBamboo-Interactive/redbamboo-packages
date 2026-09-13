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

test("parses absolute Markdown drive paths with encoded spaces and locations", () => {
  assert.deepEqual(parseLocalFileLink("/L:/Workspaces/Nova/memory/projects/Double%20Message%20Audit%202026-09-13.md"), {
    filePath: "L:/Workspaces/Nova/memory/projects/Double Message Audit 2026-09-13.md", line: undefined, column: undefined,
  })
  assert.deepEqual(parseLocalFileLink("/T:/Projects/file.cs:12:4"), {
    filePath: "T:/Projects/file.cs", line: 12, column: 4,
  })
  assert.equal(parseLocalFileLink("/apps/nova/journal/memory/note.md"), null)
  assert.equal(parseLocalFileLink("//server/share/file.md"), null)
})

test("does not claim web or relative links", () => {
  assert.equal(parseLocalFileLink("https://example.com/file.cs:12"), null)
  assert.equal(parseLocalFileLink("docs/file.md:12"), null)
})

test("the exact audit link reaches local-file handling after Markdown parsing", () => {
  const parsed: unknown[] = []
  renderToStaticMarkup(createElement(Markdown, {
    urlTransform: (url: string) => url,
    components: { a: ({ href }: { href?: string }) => { parsed.push(parseLocalFileLink(href)); return null } },
  }, "[Audit](</L:/Workspaces/Nova/memory/projects/Double Message Audit 2026-09-13.md>)"))
  assert.deepEqual(parsed, [{ filePath: "L:/Workspaces/Nova/memory/projects/Double Message Audit 2026-09-13.md", line: undefined, column: undefined }])
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
