import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import Markdown from "react-markdown"
import rehypeHighlight from "rehype-highlight"
import remarkGfm from "remark-gfm"
import { colorSwatchValue, isColorLiteral, rehypeColorSwatches } from "./color-swatch.ts"
import { remarkUserText } from "./user-markdown.ts"

function render(content: string, userText = false): string {
  return renderToStaticMarkup(createElement(Markdown, {
    remarkPlugins: userText ? [remarkGfm, remarkUserText] : [remarkGfm],
    rehypePlugins: [rehypeHighlight, rehypeColorSwatches],
  }, content))
}

const swatch = (color: string) => `<span data-slot="color-swatch" aria-hidden="true" style="background-color:${color}"></span>`
const swatchCount = (html: string) => html.split('data-slot="color-swatch"').length - 1
const text = (html: string) => html.replace(/<[^>]*>/g, "")

test("accepts every supported colour form", () => {
  for (const value of [
    "#FFF", "#fffa", "#E8A3B1", "#E8A3B180",
    "rgb(255, 0, 0)", "rgba(255, 0, 0, 0.5)", "rgb(100%, 0%, 0%)", "rgba(0,0,0,50%)", "rgb(255,0,0,.5)",
    "rgb(255 0 0)", "rgb(255 0 0 / 50%)", "rgb(100% 0 0 / .5)", "RGB(1 2 3)",
    "hsl(120, 50%, 50%)", "hsla(120deg, 50%, 50%, 0.3)", "hsl(0.5turn 50% 50%)", "hsl(120 50 50 / 0.2)", "hsl(-30 100% 50%)",
    "rgb(999,0,0)",
  ]) {
    assert.equal(isColorLiteral(value), true, value)
  }
})

test("rejects look-alikes and unsupported forms", () => {
  for (const value of [
    "#GGG", "#12345", "#1234567", "#", "FFF", "red", "colour", "transparent", "currentColor",
    "rgb()", "rgb(1, 2)", "rgb(1, 2, 3, 4, 5)", "rgb(1, 2 3)", "rgb(1, 2, 3,)", "rgb(1, 2%, 3)", "rgb(1,2,3 / 0.5)",
    "rgb(1 2 3 /)", "rgb(1 2 3 / 0.5 / 1)", "rgb (1, 2, 3)", "rgb(1 2 3", "hsl(120, 50, 50)", "hsl(120px 50% 50%)",
    "lab(50% 40 59)", "color(srgb 1 0 0)", "rgb(none 0 0)",
  ]) {
    assert.equal(isColorLiteral(value), false, value)
  }
})

test("rejects text that would inject other declarations", () => {
  for (const value of [
    "red; background:url(x)", "#fff; background:url(x)", "#fff;", "rgb(1,2,3); color: red", "rgb(1,2,url(x))",
    "rgb(1 2 3) url(x)", "expression(alert(1))", "rgb(1,2,3)\"><script>", `#fff${"0".repeat(100)}`,
  ]) {
    assert.equal(colorSwatchValue(value), null, value)
  }
  assert.equal(render("`red; background:url(x)`"), "<p><code>red; background:url(x)</code></p>")
})

test("draws a swatch inside inline code that holds only a colour", () => {
  assert.equal(render("Primary is `#E8A3B1`."), `<p>Primary is <code>#E8A3B1${swatch("#E8A3B1")}</code>.</p>`)
  assert.equal(render("`  rgb(255 0 0 / 50%) `"), `<p><code> rgb(255 0 0 / 50%)${swatch("rgb(255 0 0 / 50%)")}</code></p>`)
  const html = render("White `#FFFFFF`, black `#000000`, glass `#00000080`, `hsl(210, 80%, 50%)`.")
  assert.equal(swatchCount(html), 4)
  assert.equal(text(html), "White #FFFFFF, black #000000, glass #00000080, hsl(210, 80%, 50%).")
})

test("draws swatches in user-typed text too", () => {
  assert.equal(render("try `#fff`\nor `#000`", true), `<p>try <code>#fff${swatch("#fff")}</code><br/>\nor <code>#000${swatch("#000")}</code></p>`)
})

test("leaves fenced code, bare text, links and mixed code alone", () => {
  assert.equal(swatchCount(render("```\n#FFFFFF\n```")), 0)
  assert.equal(swatchCount(render("```css\n#FFFFFF\n```")), 0)
  assert.equal(swatchCount(render("    #FFFFFF")), 0)
  assert.equal(swatchCount(render("The colour #FFFFFF and rgb(1, 2, 3).")), 0)
  assert.equal(swatchCount(render("[`#FFFFFF`](https://example.com)")), 0)
  assert.equal(swatchCount(render("`color: #FFFFFF`")), 0)
  assert.equal(swatchCount(render("`#FFFFFF #000000`")), 0)
})

test("partial streaming tokens render without a swatch until the span closes", () => {
  const message = "Use `#E8A3` for the accent and `rgba(0, 0, 0, 0.5)` for the scrim."
  for (let end = 0; end <= message.length; end++) {
    const html = render(message.slice(0, end))
    const closed = (message.slice(0, end).match(/`/g) ?? []).length
    assert.equal(swatchCount(html), Math.floor(closed / 2), message.slice(0, end))
  }
  assert.equal(swatchCount(render("Use `#E8A3")), 0)
  assert.equal(swatchCount(render("Use `rgb(12, 3")), 0)
})

test("defers to CSS.supports when the browser provides it", () => {
  const scope = globalThis as { CSS?: unknown }
  const previous = scope.CSS
  try {
    scope.CSS = { supports: (_property: string, value: string) => value !== "hsl(1e3 50% 50%)" }
    assert.equal(colorSwatchValue("hsl(1e3 50% 50%)"), null)
    assert.equal(colorSwatchValue(" #fff "), "#fff")
  } finally {
    scope.CSS = previous
  }
})
