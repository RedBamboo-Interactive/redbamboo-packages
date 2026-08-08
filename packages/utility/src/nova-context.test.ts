import test from "node:test"
import assert from "node:assert/strict"
import {
  VisibleAppContextCaptureError,
  assertSourceUrlUnchanged,
  formatContextMessage,
  resolveActiveAppIdentity,
} from "./nova-context-core.ts"

function fakeDocument(): Document {
  const shell = { dataset: { activeAppId: "codered", activeAppName: "CodeRed" } }
  return {
    title: "Session · CodeRed",
    body: {},
    querySelector(selector: string) {
      return selector === '[data-slot="app-shell"]' ? shell : null
    },
    querySelectorAll() { return [] },
  } as unknown as Document
}

test("formats bounded visible context without allowing arbitrary XML element names", () => {
  const formatted = formatContextMessage({
    app: "Code&Red",
    appId: "codered",
    url: "http://local/<session>",
    selection: "a < b",
    screenshot: { mediaType: "image/png", base64: "abc" },
    extra: { heading: "Build & Test", "bad key": "excluded" },
  }, "Why did this fail?")

  assert.match(formatted, /source="Code&amp;Red"/)
  assert.match(formatted, /<app-id>codered<\/app-id>/)
  assert.match(formatted, /<selected-text>a &lt; b<\/selected-text>/)
  assert.match(formatted, /<heading>Build &amp; Test<\/heading>/)
  assert.doesNotMatch(formatted, /bad key/)
  assert.match(formatted, /<has-screenshot>true<\/has-screenshot>/)
  assert.ok(formatted.endsWith("Why did this fail?"))
})

test("resolves active plugin identity from the semantic AppShell contract", () => {
  assert.deepEqual(resolveActiveAppIdentity(fakeDocument()), { id: "codered", name: "CodeRed" })
})

test("rejects context captured across a foreground route change", () => {
  assert.doesNotThrow(() => assertSourceUrlUnchanged("/apps/codered/a", "/apps/codered/a"))
  assert.throws(
    () => assertSourceUrlUnchanged("/apps/codered/a", "/apps/codered/b"),
    (error: unknown) => error instanceof VisibleAppContextCaptureError && error.code === "source_changed",
  )
})
