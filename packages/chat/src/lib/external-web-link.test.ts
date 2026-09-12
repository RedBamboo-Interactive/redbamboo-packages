import assert from "node:assert/strict"
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
