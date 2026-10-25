import assert from "node:assert/strict"
import test from "node:test"
import type { MessagePart } from "../types.ts"
import { imageReadPath } from "./image-read.ts"

const tool = (toolName: string, input: unknown): MessagePart => ({
  type: "tool_use",
  content: "",
  toolName,
  toolInput: typeof input === "string" ? input : JSON.stringify(input),
})

test("recognizes explicit image-view tools across provider spellings", () => {
  assert.equal(imageReadPath(tool("view_image", { path: "L:/art/portrait" })), "L:/art/portrait")
  assert.equal(imageReadPath(tool("mcp__vision__view_image", { file_path: "L:/art/map.webp" })), "L:/art/map.webp")
  assert.equal(imageReadPath(tool("ViewImage", { image_path: "/api/assets/look.png" })), "/api/assets/look.png")
})

test("recognizes Read only when its target is an image", () => {
  assert.equal(imageReadPath(tool("Read", { file_path: "L:/art/map.PNG" })), "L:/art/map.PNG")
  assert.equal(imageReadPath(tool("Read", { file_path: "/api/assets/look.avif?size=small" })), "/api/assets/look.avif?size=small")
  assert.equal(imageReadPath(tool("Read", { file_path: "L:/notes/readme.md" })), undefined)
})

test("rejects malformed, unrelated, and result parts", () => {
  assert.equal(imageReadPath(tool("view_image", "{")), undefined)
  assert.equal(imageReadPath(tool("image_generate", { path: "L:/art/map.png" })), undefined)
  assert.equal(imageReadPath({ type: "tool_result", content: "ok", toolName: "view_image", toolInput: "{}" }), undefined)
})
