import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { canonicalizeLeafLinkHref, isExternalWebLink, isInternalLeafLink } from "./external-web-link.ts"
import { parseLocalFileLink } from "./local-file-link.ts"

test("recognizes absolute HTTP and HTTPS links as external web actions", () => {
  assert.equal(isExternalWebLink("https://openai.com"), true)
  assert.equal(isExternalWebLink("HTTP://example.com/path"), true)
})

test("leaves Leaf, relative, local file, and non-web schemes alone", () => {
  assert.equal(isExternalWebLink("/apps/nova/chat"), false)
  assert.equal(isExternalWebLink("docs/guide.md"), false)
  assert.equal(isExternalWebLink("T:/Projects/nova/README.md"), false)
  assert.equal(isExternalWebLink("mailto:hello@example.com"), false)
})

test("recognizes root-relative and same-origin absolute Leaf links", () => {
  const origin = "http://127.0.0.1:18804"

  assert.equal(isInternalLeafLink("/workspace/abc", origin), true)
  assert.equal(isInternalLeafLink("http://127.0.0.1:18804/apps/nova", origin), true)
  assert.equal(isInternalLeafLink("https://openai.com", origin), false)
  assert.equal(isInternalLeafLink("docs/guide.md", origin), false)
  assert.equal(isInternalLeafLink("//example.com/path", origin), false)
})

test("the external web pill explicitly defeats Markdown link underlining", () => {
  const component = readFileSync(
    new URL("../components/streaming-text.tsx", import.meta.url),
    "utf8",
  )
  const externalPill = component.slice(component.indexOf('data-slot="external-web-link"'))

  assert.match(externalPill, /textDecoration: "none"/)
})

test("authored loopback Leaf links stay on the current origin", () => {
  const leafPath = "/apps/nova/journal/memory/My%20Report.md?view=read#section"
  for (const host of ["localhost", "127.0.0.1", "127.0.0.2", "[::1]", "nova.localhost"]) {
    const href = canonicalizeLeafLinkHref("http://" + host + ":18804" + leafPath)
    assert.equal(href, leafPath)
    assert.equal(new URL(href!, "https://leaf.example").origin, "https://leaf.example")
    assert.equal(isInternalLeafLink(href, "https://leaf.example"), true)
  }
  assert.equal(canonicalizeLeafLinkHref("https://localhost:18804/workspace/abc"), "/workspace/abc")
})

test("historical localhost-wrapped drive paths still reach the file resolver", () => {
  assert.deepEqual(parseLocalFileLink(canonicalizeLeafLinkHref(
    "http://localhost:18804/L:/Workspaces/Nova/My%20Report.md:12:4",
  )), { filePath: "L:/Workspaces/Nova/My Report.md", line: 12, column: 4 })
})

test("ordinary external links, other local services and non-web references are preserved", () => {
  for (const href of [
    undefined, "", "docs/note.md", "/apps/nova", "//localhost:18804/apps/nova",
    "L:/Workspaces/Nova/note.md", "file:///L:/Workspaces/Nova/note.md",
    "mailto:nova@example.com", "http://localhost:3000/apps/nova",
    "http://127.0.0.1:18800/health", "http://localhost/apps/nova",
    "http://localhost.evil.example:18804/apps/nova", "https://example.com:18804/apps/nova",
    "http://user:pass@localhost:18804/apps/nova", "http://[broken",
    "http://localhost:18804//example.com/path",
  ]) assert.equal(canonicalizeLeafLinkHref(href), href)
})
