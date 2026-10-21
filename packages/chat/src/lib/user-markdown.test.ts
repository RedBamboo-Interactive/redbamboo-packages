import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import Markdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { isUnsafeLinkHref, remarkUserText } from "./user-markdown.ts"

function renderUserText(content: string): string {
  return renderToStaticMarkup(createElement(Markdown, { remarkPlugins: [remarkGfm, remarkUserText] }, content))
}

test("formats Markdown a person typed", () => {
  const html = renderUserText("**Read first:** `memory/index.md`\n\n## Pending\n1. one\n2. two")
  assert.match(html, /<strong>Read first:<\/strong> <code>memory\/index\.md<\/code>/)
  assert.match(html, /<h2>Pending<\/h2>/)
  assert.match(html, /<ol>\s*<li>one<\/li>\s*<li>two<\/li>\s*<\/ol>/)
})

test("keeps a single typed newline as a line break", () => {
  assert.equal(renderUserText("first line\nsecond line"), "<p>first line<br/>\nsecond line</p>")
  assert.equal(renderUserText("a\r\nb"), "<p>a<br/>\nb</p>")
})

test("keeps line breaks inside emphasis and list items", () => {
  assert.equal(renderUserText("*one\ntwo*"), "<p><em>one<br/>\ntwo</em></p>")
  assert.match(renderUserText("- item\n  continued"), /<li>item<br\/>\s*continued<\/li>/)
})

test("leaves code blocks and inline code untouched", () => {
  assert.equal(renderUserText("```\na\nb\n```"), "<pre><code>a\nb\n</code></pre>")
  assert.equal(renderUserText("use `Vec<T>` here"), "<p>use <code>Vec&lt;T&gt;</code> here</p>")
})

test("shows inline and block raw HTML literally instead of dropping it", () => {
  assert.equal(renderUserText("an Option<String> value"), "<p>an Option&lt;String&gt; value</p>")
  assert.equal(renderUserText("<div>\nhi\n</div>"), "<p>&lt;div&gt;<br/>\nhi<br/>\n&lt;/div&gt;</p>")
  assert.equal(renderUserText("> <br>"), "<blockquote>\n<p>&lt;br&gt;</p>\n</blockquote>")
})

test("flags only links that would run script or inline content", () => {
  for (const href of ["javascript:alert(1)", " JavaScript:alert(1)", "java\tscript:alert(1)", "vbscript:x", "data:text/html,x"]) {
    assert.equal(isUnsafeLinkHref(href), true, href)
  }
  for (const href of [undefined, "", "https://example.com", "/api/assets/x.png", "#top", "mailto:a@b.c", "T:/Projects/x.ts"]) {
    assert.equal(isUnsafeLinkHref(href), false, String(href))
  }
})
