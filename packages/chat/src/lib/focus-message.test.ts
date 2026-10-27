import assert from "node:assert/strict"
import { test } from "node:test"
import type { MessageBlock } from "../types"
import { findFocusBlockIndex } from "./focus-message.ts"

const block = (id: string, extra: Partial<MessageBlock> = {}): MessageBlock => ({
  id, role: "user", parts: [], timestamp: "2026-10-27T10:00:00Z", ...extra,
})

test("a block matches by id or by one of its input message uids", () => {
  const blocks = [block("a"), block("b", { inputMessageUids: ["x", "y"] }), block("c")]
  assert.equal(findFocusBlockIndex(blocks, "c"), 2)
  assert.equal(findFocusBlockIndex(blocks, "y"), 1)
  assert.equal(findFocusBlockIndex(blocks, "missing"), -1)
})

test("an id match wins over an input uid match elsewhere", () => {
  const blocks = [block("a", { inputMessageUids: ["b"] }), block("b")]
  assert.equal(findFocusBlockIndex(blocks, "b"), 1)
})
