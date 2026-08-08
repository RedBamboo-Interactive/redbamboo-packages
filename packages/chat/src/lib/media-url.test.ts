import assert from "node:assert/strict"
import test from "node:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import Markdown from "react-markdown"
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

test("normalizes Windows paths before calling the host resolver", () => {
  const seen: string[] = []
  const resolve = (src: string) => {
    seen.push(src)
    return `/api/apps/nova/file?path=${encodeURIComponent(src)}`
  }

  assert.equal(
    resolveChatMediaSrc("S:%5CNova%5Cproof.png", resolve),
    "/api/apps/nova/file?path=S%3A%5CNova%5Cproof.png",
  )
  assert.equal(
    resolveChatMediaSrc("S:/Nova/proof.png", resolve),
    "/api/apps/nova/file?path=S%3A%2FNova%2Fproof.png",
  )
  assert.equal(
    resolveChatMediaSrc("file:///S:/Nova/proof.png", resolve),
    "/api/apps/nova/file?path=S%3A%2FNova%2Fproof.png",
  )
  assert.deepEqual(seen, ["S:\\Nova\\proof.png", "S:/Nova/proof.png", "S:/Nova/proof.png"])
})

test("recovers a backslash path after the real Markdown parser encodes it", () => {
  const resolved: string[] = []
  const resolve = (src: string) => /^[A-Za-z]:[\\/]/.test(src)
    ? `/api/apps/nova/file?path=${encodeURIComponent(src)}`
    : src

  renderToStaticMarkup(createElement(
    Markdown,
    {
      urlTransform: (url: string) => url,
      components: {
        img: ({ src }: { src?: string }) => {
          resolved.push(resolveChatMediaSrc(src, resolve) ?? "")
          return null
        },
      },
    },
    String.raw`![proof](S:\Nova\proof.png)`,
  ))

  assert.deepEqual(resolved, ["/api/apps/nova/file?path=S%3A%5CNova%5Cproof.png"])
})
