import { test } from "node:test"
import assert from "node:assert/strict"
import { fencedBlockLanguage, type HastElementLike } from "./host-blocks.ts"
import { codeBlockSource } from "./chat-actions.ts"

const pre = (className: unknown, text = "done ad7278d0: shipped\n"): HastElementLike => ({
  type: "element",
  tagName: "pre",
  children: [{ type: "element", tagName: "code", properties: { className }, children: [{ type: "text", value: text }] }],
})

test("a fenced block's language comes from its code element's language class", () => {
  assert.equal(fencedBlockLanguage(pre(["language-nova-report"])), "nova-report")
  assert.equal(fencedBlockLanguage(pre(["hljs", "language-Nova-Report"])), "nova-report")
  assert.equal(fencedBlockLanguage(pre("language-nova-report hljs")), "nova-report")
})

test("blocks without a language, or with an empty one, have none", () => {
  assert.equal(fencedBlockLanguage(pre(undefined)), null)
  assert.equal(fencedBlockLanguage(pre(["hljs"])), null)
  assert.equal(fencedBlockLanguage(pre(["language-"])), null)
  assert.equal(fencedBlockLanguage(undefined), null)
  assert.equal(fencedBlockLanguage({ type: "element", tagName: "pre", children: [{ type: "text", value: "x" }] }), null)
})

test("the host gets the authored source, as Code Copy does", () => {
  assert.equal(codeBlockSource(pre(["language-nova-report"], "title: Morning\ndone ad7278d0: shipped\n")), "title: Morning\ndone ad7278d0: shipped")
})
