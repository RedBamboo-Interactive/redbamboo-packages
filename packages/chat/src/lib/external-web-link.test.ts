import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import test from "node:test"
import { isExternalWebLink } from "./external-web-link.ts"

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

test("the external web pill explicitly defeats Markdown link underlining", () => {
  const component = readFileSync(
    new URL("../components/streaming-text.tsx", import.meta.url),
    "utf8",
  )
  const externalPill = component.slice(component.indexOf('data-slot="external-web-link"'))

  assert.match(externalPill, /textDecoration: "none"/)
})
