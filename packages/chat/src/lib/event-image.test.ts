import { test } from "node:test"
import assert from "node:assert/strict"
import { eventImage, isImageUrl } from "./event-image.ts"

/** The payload shape the smart-home plugin emits for camera-person events. */
const cameraPayload = {
  camera: "backyard",
  camera_name: "Backyard",
  room: "Garden",
  type: "person",
  asset_id: "7c23609c-0149-4769-a16d-c2a2176624fd.webp",
  asset_url: "/api/assets/7c23609c-0149-4769-a16d-c2a2176624fd.webp",
  frame_error: null,
  sdm_event_id: "abc",
  timestamp: "2026-07-28T19:00:00Z",
}

test("picks up asset_url from a camera payload", () => {
  assert.deepEqual(eventImage(cameraPayload), {
    src: "/api/assets/7c23609c-0149-4769-a16d-c2a2176624fd.webp",
  })
})

test("resolves a bare asset_id to the assets endpoint", () => {
  const { asset_url, ...withoutUrl } = cameraPayload
  assert.deepEqual(eventImage(withoutUrl), {
    src: "/api/assets/7c23609c-0149-4769-a16d-c2a2176624fd.webp",
  })
})

test("accepts camelCase keys", () => {
  assert.deepEqual(eventImage({ assetUrl: "/api/assets/x.png" }), { src: "/api/assets/x.png" })
  assert.deepEqual(eventImage({ imageUrl: "https://cdn/x.jpg" }), { src: "https://cdn/x.jpg" })
  assert.deepEqual(eventImage({ assetId: "abc.webp" }), { src: "/api/assets/abc.webp" })
})

test("a declared image media type stands in for a missing extension", () => {
  assert.equal(eventImage({ asset_id: "abc123" }), null, "no extension, no media type — not an image")
  assert.deepEqual(
    eventImage({ asset_id: "abc123", media_type: "image/webp" }),
    { src: "/api/assets/abc123" },
  )
  assert.deepEqual(
    eventImage({ asset_url: "/api/assets/abc123", contentType: "image/png" }),
    { src: "/api/assets/abc123" },
  )
})

test("ignores assets that aren't images", () => {
  assert.equal(eventImage({ asset_url: "/api/assets/clip.mp4" }), null)
  assert.equal(eventImage({ asset_url: "/api/assets/report.pdf", media_type: "application/pdf" }), null)
})

test("frame_error replaces the image", () => {
  assert.deepEqual(
    eventImage({ ...cameraPayload, frame_error: "camera offline" }),
    { error: "camera offline" },
    "an error wins over the asset that failed",
  )
  assert.deepEqual(eventImage({ frameError: "timeout" }), { error: "timeout" })
})

test("a null frame_error is not an error", () => {
  assert.deepEqual(eventImage({ asset_url: "/a.png", frame_error: null }), { src: "/a.png" })
})

test("payloads without an image yield null", () => {
  assert.equal(eventImage(null), null)
  assert.equal(eventImage({}), null)
  assert.equal(eventImage({ track: "Blinding Lights", albumArt: "https://cdn/art.jpg" }), null,
    "albumArt is the music renderer's business, not the generic attachment")
})

test("tolerates non-string values in the image keys", () => {
  assert.equal(eventImage({ asset_url: 42, asset_id: null }), null)
})

test("query strings and fragments don't defeat the extension check", () => {
  assert.deepEqual(eventImage({ asset_url: "/a.webp?v=2" }), { src: "/a.webp?v=2" })
})

test("recognizes image link targets", () => {
  assert.equal(isImageUrl("http://127.0.0.1:18804/api/assets/id.png"), true)
  assert.equal(isImageUrl("https://cdn.example/art.avif?size=large#preview"), true)
  assert.equal(isImageUrl("/api/assets/report.pdf"), false)
  assert.equal(isImageUrl(undefined), false)
})

test("loopback RedLeaf event images use the current chat origin", () => {
  assert.deepEqual(
    eventImage({ image_url: "http://127.0.0.1:18804/api/assets/id.png?v=2" }),
    { src: "/api/assets/id.png?v=2" },
  )
})

test("data URLs are accepted", () => {
  const src = "data:image/png;base64,iVBORw0KGgo="
  assert.deepEqual(eventImage({ image_url: src }), { src })
})

test("resolveImageSrc rewrites the resolved source", () => {
  assert.deepEqual(
    eventImage({ asset_url: "/a.png" }, s => `https://host${s}`),
    { src: "https://host/a.png" },
  )
  assert.deepEqual(
    eventImage({ asset_url: "/a.png" }, () => undefined),
    { src: "/a.png" },
    "falls back to the raw source when the host declines to rewrite",
  )
})
