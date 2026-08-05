import assert from "node:assert/strict"
import test from "node:test"
import { canonicalizeChatMediaSrc, resolveChatMediaSrc } from "./media-url.ts"

test("canonicalizes loopback RedLeaf assets to same-origin URLs", () => {
  assert.equal(
    canonicalizeChatMediaSrc("http://127.0.0.1:18804/api/assets/image.png"),
    "/api/assets/image.png",
  )
  assert.equal(
    canonicalizeChatMediaSrc("https://localhost:18804/api/assets/image.webp?v=2#preview"),
    "/api/assets/image.webp?v=2#preview",
  )
  assert.equal(
    canonicalizeChatMediaSrc("http://[::1]:18804/api/redleaf-asset/legacy.jpg"),
    "/api/redleaf-asset/legacy.jpg",
  )
  assert.equal(
    canonicalizeChatMediaSrc("http://nova.localhost:18804/api/assets/image.png"),
    "/api/assets/image.png",
  )
})

test("leaves non-RedLeaf and non-loopback URLs untouched", () => {
  const values = [
    "https://cdn.example/image.png",
    "http://127.0.0.1:18800/output/image.png",
    "http://192.168.1.10:18804/api/assets/image.png",
    "/api/assets/image.png",
    "data:image/png;base64,abc",
    "blob:https://redleaf.minititine.cc/id",
    "C:\\temp\\image.png",
    "not a URL",
  ]

  for (const value of values)
    assert.equal(canonicalizeChatMediaSrc(value), value)
})

test("applies a host resolver before canonicalizing its result", () => {
  assert.equal(
    resolveChatMediaSrc("C:\\temp\\image.png", () => "http://127.0.0.1:18804/api/assets/upload.png"),
    "/api/assets/upload.png",
  )
  assert.equal(
    resolveChatMediaSrc("http://127.0.0.1:18804/api/assets/image.png", () => undefined),
    "/api/assets/image.png",
  )
  assert.equal(resolveChatMediaSrc(undefined), undefined)
})
