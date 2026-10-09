import assert from "node:assert/strict"
import { after, before, test } from "node:test"
import { fileURLToPath } from "node:url"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { createServer } from "vite"

let server
let MasterDetailLayout
const originalWindow = globalThis.window

before(async () => {
  // Load the real TSX and its dependencies with the existing build tool.
  server = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    configFile: false,
    esbuild: { jsx: "automatic" },
    server: { middlewareMode: true, watch: null },
    appType: "custom",
  })
  ;({ MasterDetailLayout } = await server.ssrLoadModule("/src/components/master-detail.tsx"))
})

after(async () => {
  if (originalWindow === undefined) delete globalThis.window
  else globalThis.window = originalWindow
  await server?.close()
})

function render(props = {}, desktop = true) {
  globalThis.window = { matchMedia: () => ({ matches: desktop }) }
  return renderToStaticMarkup(createElement(MasterDetailLayout, {
    sidebar: createElement("span", null, "Discussion list"),
    detail: createElement("span", null, "Conversation"),
    ...props,
  }))
}

function assertOrder(markup, side, resizable) {
  const sidebar = markup.indexOf('data-slot="master-detail-sidebar"')
  const content = markup.indexOf('data-slot="master-detail-content"')
  assert.ok(sidebar >= 0 && content >= 0, "both desktop panels render")
  assert.ok(side === "left" ? sidebar < content : content < sidebar)
  if (resizable) {
    const handle = markup.indexOf('data-slot="resizable-handle"')
    assert.ok(handle > Math.min(sidebar, content) && handle < Math.max(sidebar, content),
      "the resize handle stays between the panels")
  } else {
    assert.ok(!markup.includes('data-slot="resizable-handle"'))
    const sidebarTag = markup.slice(markup.lastIndexOf("<div", sidebar), markup.indexOf(">", sidebar))
    assert.match(sidebarTag, side === "left" ? /\bborder-r\b/ : /\bborder-l\b/)
    assert.doesNotMatch(sidebarTag, side === "left" ? /\bborder-l\b/ : /\bborder-r\b/)
  }
}

for (const resizable of [false, true]) {
  const kind = resizable ? "resizable" : "fixed"
  const props = resizable ? { layoutKey: "test-master-detail" } : {}
  test(`${kind} desktop defaults to a left sidebar`, () => {
    assertOrder(render(props), "left", resizable)
  })
  for (const sidebarPosition of ["left", "right"]) {
    test(`${kind} desktop supports an explicit ${sidebarPosition} sidebar`, () => {
      assertOrder(render({ ...props, sidebarPosition }), sidebarPosition, resizable)
    })
  }
}

for (const presentation of ["responsive", "compact"]) {
  for (const mobileTab of [0, 1]) {
    test(`${presentation} tabs retain order and selected tab ${mobileTab} on either side`, () => {
      const props = { presentation, mobileTab, layoutKey: "test-master-detail", mobileLabels: ["Discussions", "Chat"] }
      // Compact stays tabbed even on desktop; responsive uses the mobile viewport.
      const left = render({ ...props, sidebarPosition: "left" }, presentation === "compact")
      const right = render({ ...props, sidebarPosition: "right" }, presentation === "compact")
      // React generates fresh IDs per render; normalize only those opaque IDs.
      const normalize = (markup) => markup.replace(/_R_[^"]*/g, "REACT_ID")
      assert.equal(normalize(left), normalize(right))
      assert.ok(left.indexOf(">Discussions<") < left.indexOf(">Chat<"))
      assert.ok(!left.includes('data-slot="resizable-panel-group"'))
      assert.ok(left.includes(mobileTab === 0 ? "Discussion list" : "Conversation"))
    })
  }
}