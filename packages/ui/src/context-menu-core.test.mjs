import assert from "node:assert/strict"
import { beforeEach, test } from "node:test"
import {
  buildContextMenuSections,
  capContributions,
  classifyContextMenuEvent,
  configureContextMenu,
  createContextMenuRunContext,
  getContextTarget,
  isTouchGestureOwned,
  normalizeContextMenuEntries,
  registerBuiltinContextMenuProviders,
  registerContextMenuProvider,
  registerContextTarget,
  shellRouteOf,
} from "./context-menu-core.ts"

/** Minimal element double: the core only reads these members. */
function el(tagName, attributes = {}, extra = {}) {
  const attrs = { ...attributes }
  return {
    nodeType: 1,
    tagName: tagName.toUpperCase(),
    textContent: extra.text ?? "",
    isContentEditable: extra.editable ?? false,
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    hasAttribute: (name) => name in attrs,
    matches: (selector) => selector.split(",").some((part) => {
      const match = part.trim().match(/^\[([\w-]+)(?:="([^"]*)")?\](?::not\(\[([\w-]+)\]\))?$/)
      if (!match || (match[3] && match[3] in attrs)) return false
      return match[2] === undefined ? match[1] in attrs : attrs[match[1]] === match[2]
    }),
    ...(extra.href ? { href: extra.href } : {}),
    ...(extra.src ? { src: extra.src, currentSrc: extra.src } : {}),
  }
}

const event = (path, overrides = {}) => ({
  defaultPrevented: false,
  shiftKey: false,
  composedPath: () => path,
  ...overrides,
})

const fakeWindow = { location: { origin: "http://127.0.0.1:18804", href: "http://127.0.0.1:18804/apps/nova" }, isSecureContext: true }
const ctx = (target) => ({ target, surface: "context-menu", document: {}, window: fakeWindow, navigate: () => {}, copyText: async () => true })

let restore = () => {}
beforeEach(() => {
  restore()
  restore = configureContextMenu({ enabled: true, openCommandPalette: undefined, resolveCommand: undefined })
  registerBuiltinContextMenuProviders()
})

// ── Passthrough ─────────────────────────────────────────────────────────────

test("an event another handler already took is left alone", () => {
  assert.equal(classifyContextMenuEvent(event([el("div")], { defaultPrevented: true })), "ignore")
})

test("Shift+right-click always opens the browser menu", () => {
  assert.equal(classifyContextMenuEvent(event([el("div")], { shiftKey: true })), "native")
})

test("Shift+F10 from the keyboard still opens the Leaf menu", () => {
  assert.equal(classifyContextMenuEvent(event([el("div")], { shiftKey: true }), { keyboard: true }), "leaf")
})

test("editable targets keep the browser menu", () => {
  assert.equal(classifyContextMenuEvent(event([el("input"), el("form")])), "native")
  assert.equal(classifyContextMenuEvent(event([el("textarea")])), "native")
  assert.equal(classifyContextMenuEvent(event([el("span", {}, { editable: true }), el("div")])), "native")
})

test("data-context-menu: nearest value wins; native passes through, none suppresses", () => {
  assert.equal(classifyContextMenuEvent(event([el("span"), el("div", { "data-context-menu": "native" })])), "native")
  assert.equal(classifyContextMenuEvent(event([el("canvas"), el("div", { "data-context-menu": "none" })])), "suppress")
  assert.equal(classifyContextMenuEvent(event([
    el("span", { "data-context-menu": "native" }),
    el("div", { "data-context-menu": "none" }),
  ])), "native")
})

test("a right-drag past 5 px opens no menu", () => {
  assert.equal(classifyContextMenuEvent(event([el("div")]), { dragDistance: 5 }), "leaf")
  assert.equal(classifyContextMenuEvent(event([el("div")]), { dragDistance: 6 }), "suppress")
})

test("Base UI context-menu triggers and chat rows own their touch long-press", () => {
  assert.equal(isTouchGestureOwned([el("button", { "data-slot": "context-menu-trigger" })]), true)
  assert.equal(isTouchGestureOwned([el("p"), el("div", { "data-message-uid": "m1" })]), true)
  assert.equal(isTouchGestureOwned([el("div", { "data-slot": "item-list-row" })]), false)
})

test("a chat row that hands its long-press to the Leaf menu is not owned", () => {
  assert.equal(isTouchGestureOwned([el("p"), el("div", { "data-message-uid": "m1", "data-leaf-long-press": "" })]), false)
  // The composer's send options still keep theirs inside such a row.
  assert.equal(isTouchGestureOwned([
    el("button", { "data-slot": "context-menu-trigger" }),
    el("div", { "data-message-uid": "m1", "data-leaf-long-press": "" }),
  ]), true)
})

// ── Toggle ──────────────────────────────────────────────────────────────────

test("registrations are inert no-ops while the menu is off", () => {
  restore()
  restore = configureContextMenu({ enabled: false })
  const row = el("div")
  const unregister = registerContextTarget(row, { getItems: () => [{ id: "a", label: "A" }] })
  assert.equal(getContextTarget(row), undefined)
  unregister()

  restore()
  restore = configureContextMenu({ enabled: true })
  const dispose = registerContextTarget(row, { getItems: () => [] })
  assert.ok(getContextTarget(row))
  dispose()
  assert.equal(getContextTarget(row), undefined)
})

// ── Sections ────────────────────────────────────────────────────────────────

const ids = (sections) => sections.map((section) => section.id)

test("empty space shows the page row, then the command palette", () => {
  restore()
  restore = configureContextMenu({ enabled: true, openCommandPalette: () => {} })
  const sections = buildContextMenuSections({ path: [el("main"), el("body")], ctx })
  assert.deepEqual(ids(sections), ["page", "palette"])
  assert.deepEqual(sections[0].entries.map((item) => item.id), ["page-back", "page-forward", "page-reload", "page-copy-link"])
})

test("no page row where there is no page, and none for a touch sheet", () => {
  assert.deepEqual(ids(buildContextMenuSections({ path: [el("main")], ctx, pageActions: false })), [])
  assert.deepEqual(ids(buildContextMenuSections({ path: [el("main")], ctx, objectsOnly: true })), [])
})

test("innermost registered object wins; ancestors are not merged", () => {
  const outer = el("section")
  const inner = el("div")
  const disposeOuter = registerContextTarget(outer, { getItems: () => [{ id: "outer", label: "Outer" }] })
  const disposeInner = registerContextTarget(inner, { getItems: () => [{ id: "inner", label: "Inner" }] })
  const sections = buildContextMenuSections({ path: [el("span"), inner, outer], ctx })
  assert.deepEqual(ids(sections), ["object", "page"])
  assert.deepEqual(sections[0].entries.map((item) => item.id), ["inner"])
  assert.equal(sections[0].element, inner)
  disposeOuter()
  disposeInner()
})

test("order: object, contributions, selection, link, media, page, palette", () => {
  restore()
  restore = configureContextMenu({ enabled: true, openCommandPalette: () => {} })
  const disposeOwner = registerContextMenuProvider({
    id: "test:entity",
    kind: "entity",
    match: (element) => element.getAttribute("data-entity-id"),
    getItems: (id) => [{ id: `open-${id}`, label: "Open" }],
  })
  const disposeContrib = registerContextMenuProvider({
    id: "test:ask",
    kind: "entity",
    label: "Nova",
    getItems: () => [{ id: "ask", label: "Ask" }],
  })
  const img = el("img", {}, { src: "http://127.0.0.1:18804/api/assets/a.png" })
  const anchor = el("a", { href: "/apps/nova/chat/1" }, { href: "http://127.0.0.1:18804/apps/nova/chat/1", text: "chat" })
  const card = el("div", { "data-entity-id": "e1" })
  const sections = buildContextMenuSections({
    path: [img, anchor, card, el("main")],
    selection: { text: "hello", containsTarget: true },
    ctx,
  })
  assert.deepEqual(ids(sections), ["object", "entity:contributions", "selection", "link", "image", "page", "palette"])
  assert.deepEqual(sections[0].entries.map((item) => item.id), ["open-e1"])
  assert.deepEqual(sections[1].entries.map((item) => item.id), ["ask"])
  disposeOwner()
  disposeContrib()
})

test("a link that is or wraps the object is the object's own navigation", () => {
  const card = el("a", { href: "/x", "data-entity-id": "e1" }, { href: "http://127.0.0.1:18804/x" })
  const dispose = registerContextMenuProvider({
    id: "test:entity",
    kind: "entity",
    match: (element) => element.getAttribute("data-entity-id"),
    getItems: () => [{ id: "open", label: "Open" }],
  })
  const wrapper = el("a", { href: "/y" }, { href: "http://127.0.0.1:18804/y" })
  assert.deepEqual(ids(buildContextMenuSections({ path: [el("span"), card], ctx })), ["object", "page"])
  assert.deepEqual(ids(buildContextMenuSections({ path: [el("div", { "data-entity-id": "e2" }), wrapper], ctx })), ["object", "page"])
  dispose()
})

test("a target that declines hands the menu to the next ancestor", () => {
  const outer = el("section")
  const inner = el("div")
  const pressed = el("span")
  let seen = null
  const disposeOuter = registerContextTarget(outer, { getItems: () => [{ id: "outer", label: "Outer" }] })
  const disposeInner = registerContextTarget(inner, { getItems: (context) => { seen = context.target; return null } })
  const sections = buildContextMenuSections({ path: [pressed, inner, outer], ctx })
  assert.equal(seen, inner)
  assert.deepEqual(ids(sections), ["object", "page"])
  assert.deepEqual(sections[0].entries.map((item) => item.id), ["outer"])
  assert.equal(sections[0].element, outer)
  disposeOuter()
  disposeInner()
})

test("run contexts carry the pressed element, null by default", () => {
  const pressed = el("span")
  const base = { target: el("div"), surface: "context-menu", document: {}, window: fakeWindow }
  assert.equal(createContextMenuRunContext(base).origin, null)
  assert.equal(createContextMenuRunContext({ ...base, origin: pressed }).origin, pressed)
})

test("declared media beats the thumbnail pixels pressed", () => {
  const poster = el("img", {}, { src: "blob:poster" })
  const thumb = el("button", { "data-context-media": "video", "data-context-media-src": "http://127.0.0.1:18804/api/assets/clip.mp4" })
  const sections = buildContextMenuSections({ path: [poster, thumb], ctx })
  assert.deepEqual(ids(sections), ["video", "page"])
  assert.equal(sections[0].element, thumb)
  assert.deepEqual(sections[0].entries.map((item) => item.id), ["video-open", "video-save", "video-copy-url"])
  // An unknown kind or a missing source is not media.
  const bogus = el("div", { "data-context-media": "pdf", "data-context-media-src": "x" })
  assert.deepEqual(ids(buildContextMenuSections({ path: [el("span"), bogus], ctx })), ["page"])
})

test("selection only when the pointer is on it", () => {
  assert.deepEqual(ids(buildContextMenuSections({ path: [el("p")], selection: { text: "x", containsTarget: false }, ctx })), ["page"])
  assert.deepEqual(ids(buildContextMenuSections({ path: [el("p")], selection: { text: "x", containsTarget: true }, ctx })), ["selection", "page"])
})

test("Copy image only in a secure context", () => {
  const img = el("img", {}, { src: "http://127.0.0.1:18804/api/assets/a.png" })
  const secure = buildContextMenuSections({ path: [img], ctx })[0].entries.map((item) => item.id)
  assert.deepEqual(secure, ["image-open", "image-save", "image-copy", "image-copy-url"])
  const insecureCtx = (target) => ({ ...ctx(target), window: { ...fakeWindow, isSecureContext: false } })
  const insecure = buildContextMenuSections({ path: [img], ctx: insecureCtx })[0].entries.map((item) => item.id)
  assert.deepEqual(insecure, ["image-open", "image-save", "image-copy-url"])
})

test("a throwing provider costs its own section only", () => {
  const dispose = registerContextMenuProvider({ id: "test:bad", kind: "link", getItems: () => { throw new Error("boom") } })
  const anchor = el("a", { href: "/a" }, { href: "http://127.0.0.1:18804/a" })
  const original = console.warn
  console.warn = () => {}
  try {
    const sections = buildContextMenuSections({ path: [anchor], ctx })
    assert.deepEqual(ids(sections), ["link", "link:contributions", "page"])
    assert.deepEqual(sections[1].entries, [])
  } finally {
    console.warn = original
    dispose()
  }
})

// ── Descriptors ─────────────────────────────────────────────────────────────

test("contributions past the cap fold into More", () => {
  const items = Array.from({ length: 6 }, (_, index) => ({ id: `c${index}`, label: `C${index}` }))
  const capped = capContributions(items)
  assert.deepEqual(capped.map((item) => item.id), ["c0", "c1", "c2", "more-contributions"])
  assert.deepEqual(capped[3].children.map((item) => item.id), ["c3", "c4", "c5"])
  assert.equal(capContributions(items.slice(0, 4)).length, 4)
})

test("normalize: command-backed labels, no stray separators, unlabeled items dropped", () => {
  const ran = []
  const resolve = (id) => (id === "nova:float" ? { label: "Float", shortcut: "Alt+F", run: () => ran.push(id) } : undefined)
  const result = normalizeContextMenuEntries([
    { id: "s0", separator: true },
    { id: "float", commandId: "nova:float" },
    { id: "missing", commandId: "nope" },
    { id: "s1", separator: true },
    { id: "s2", separator: true },
    { id: "close", label: "Close", danger: true },
    { id: "s3", separator: true },
  ], resolve)
  assert.deepEqual(result.map((entry) => entry.id), ["float", "s1", "close"])
  assert.equal(result[0].label, "Float")
  assert.equal(result[0].shortcut, "Alt+F")
  result[0].run()
  assert.deepEqual(ran, ["nova:float"])
})

test("shell routes exclude API, assets and other origins", () => {
  const origin = "http://127.0.0.1:18804"
  assert.equal(shellRouteOf("http://127.0.0.1:18804/apps/nova/chat/1?x=1#m", origin), "/apps/nova/chat/1?x=1#m")
  assert.equal(shellRouteOf("http://127.0.0.1:18804/api/assets/a.png", origin), null)
  assert.equal(shellRouteOf("http://127.0.0.1:18804/plugin-assets/nova/x.js", origin), null)
  assert.equal(shellRouteOf("https://example.com/", origin), null)
})

test("deferred items ride on their provider's section without blocking it", async () => {
  const dispose = registerContextMenuProvider({
    id: "test:entity",
    kind: "entity",
    match: (element) => element.getAttribute("data-entity-id"),
    getItems: () => [{ id: "open", label: "Open" }],
    getDeferredItems: async () => [{ id: "delete", label: "Delete", danger: true }],
  })
  const [object] = buildContextMenuSections({ path: [el("div", { "data-entity-id": "e1" })], ctx })
  assert.deepEqual(object.entries.map((item) => item.id), ["open"], "sync items are available immediately")
  assert.deepEqual((await object.deferred).map((item) => item.id), ["delete"])
  dispose()
})
