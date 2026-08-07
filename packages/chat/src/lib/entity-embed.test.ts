import assert from "node:assert/strict"
import { test } from "node:test"
import { parseEntityEmbedParagraph } from "./entity-embed.ts"

const href = "/database/entities/quality-mode/2795e49f-4087-e052-be15-7973309836f2"
const embedHref = "redleaf://quality-mode/2795e49f-4087-e052-be15-7973309836f2"

function paragraph(children: unknown[]) {
  return { type: "element", tagName: "p", properties: {}, children }
}

function link(url = href, children: unknown[] = [{ type: "text", value: "Deep (Codex)" }]) {
  return { type: "element", tagName: "a", properties: { href: url }, children }
}

test("upgrades one standalone canonical entity link", () => {
  assert.deepEqual(parseEntityEmbedParagraph(paragraph([link()])), {
    id: "2795e49f-4087-e052-be15-7973309836f2",
    typeSlug: "quality-mode",
    name: "Deep (Codex)",
    href,
  })
})

test("upgrades the established standalone Page entity embed", () => {
  assert.deepEqual(parseEntityEmbedParagraph(paragraph([link(embedHref)])), {
    id: "2795e49f-4087-e052-be15-7973309836f2",
    typeSlug: "quality-mode",
    name: "Deep (Codex)",
    href,
  })
})

test("does not turn preview, inline, or field references into a plain card", () => {
  assert.equal(parseEntityEmbedParagraph(paragraph([link(`${embedHref}?display=preview`)])), null)
  assert.equal(parseEntityEmbedParagraph(paragraph([link(`${embedHref}?display=inline`)])), null)
  assert.equal(parseEntityEmbedParagraph(paragraph([link(`${embedHref}?field=reasoning_effort`)])), null)
})

test("allows whitespace and formatted text inside the standalone link", () => {
  assert.equal(
    parseEntityEmbedParagraph(paragraph([
      { type: "text", value: "\n" },
      link(href, [{
        type: "element",
        tagName: "strong",
        properties: {},
        children: [{ type: "text", value: "Deep (Codex)" }],
      }]),
      { type: "text", value: "\n" },
    ]))?.name,
    "Deep (Codex)",
  )
})

test("leaves inline entity links as ordinary Markdown links", () => {
  assert.equal(parseEntityEmbedParagraph(paragraph([
    { type: "text", value: "Open " },
    link(),
    { type: "text", value: " for details." },
  ])), null)
})

test("rejects cross-origin absolute entity links", () => {
  assert.equal(parseEntityEmbedParagraph(
    paragraph([link("https://other.example/database/entities/quality-mode/id")]),
    "https://leaf.example",
  ), null)
})

test("accepts same-origin absolute entity links", () => {
  assert.equal(parseEntityEmbedParagraph(
    paragraph([link("https://leaf.example/database/entities/quality-mode/id")]),
    "https://leaf.example",
  )?.id, "id")
})
