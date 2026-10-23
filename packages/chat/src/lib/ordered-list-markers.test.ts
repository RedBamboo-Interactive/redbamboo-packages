import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import Markdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import { rehypeColorSwatches } from "./color-swatch.ts"
import { orderedListMarkerDigits, rehypeOrderedListMarkers } from "./ordered-list-markers.ts"

function render(content: string): string {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: [remarkGfm],
    rehypePlugins: [rehypeHighlight, rehypeColorSwatches, rehypeOrderedListMarkers],
  }, content))
}

const list = (count: number, start = 1) =>
  Array.from({ length: count }, (_, index) => `${start + index}. item`).join("\n")
const digitsIn = (html: string) => [...html.matchAll(/<ol[^>]*style="--marker-digits:(\d+)"/g)].map(match => Number(match[1]))

test("counts the digits of the widest number a list shows", () => {
  assert.equal(orderedListMarkerDigits(1, 9), 1)
  assert.equal(orderedListMarkerDigits(1, 10), 2)
  assert.equal(orderedListMarkerDigits(1, 99), 2)
  assert.equal(orderedListMarkerDigits(1, 100), 3)
  assert.equal(orderedListMarkerDigits(98, 3), 3)
  assert.equal(orderedListMarkerDigits(0, 10), 1)
  assert.equal(orderedListMarkerDigits(1, 0), 1)
  assert.equal(orderedListMarkerDigits(Number.NaN, 12), 2)
  assert.equal(orderedListMarkerDigits(-5, 12), 2)
})

test("declares marker width on every ordered list it renders", () => {
  assert.deepEqual(digitsIn(render(list(3))), [1])
  assert.deepEqual(digitsIn(render(list(12))), [2])
  assert.deepEqual(digitsIn(render(list(100))), [3])
})

test("accounts for a list that continues from a later number", () => {
  assert.deepEqual(digitsIn(render(list(2, 9))), [2])
  assert.deepEqual(digitsIn(render(list(1, 1000))), [4])
})

test("sizes nested lists independently and leaves bullet lists alone", () => {
  const html = render(`${list(10)}\n    1. nested\n    2. nested\n\n- bullet`)
  assert.deepEqual(digitsIn(html), [2, 1])
  assert.match(html, /<ul>\s*<li>bullet<\/li>\s*<\/ul>/)
})

test("keeps the list content intact", () => {
  const html = render("1. **one**\n2. `#FFF`")
  assert.match(html, /<li><strong>one<\/strong><\/li>/)
  assert.match(html, /data-slot="color-swatch"/)
})
