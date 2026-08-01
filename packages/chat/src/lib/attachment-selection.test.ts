import { test } from "node:test"
import assert from "node:assert/strict"
import { acceptedAttachmentFiles } from "./attachment-selection.ts"

const image = { name: "image.png", type: "image/png" }
const file = { name: "proposal.pdf", type: "application/pdf" }

test("mixed drop keeps images and regular files when both are enabled", () => {
  assert.deepEqual(acceptedAttachmentFiles([image, file], true, true), [image, file])
})

test("image-only hosts never accept arbitrary files", () => {
  assert.deepEqual(acceptedAttachmentFiles([file, image], true, false), [image])
})

test("file-only messages retain regular files without synthesizing text", () => {
  const accepted = acceptedAttachmentFiles([file], false, true)
  assert.deepEqual(accepted, [file])
  assert.equal("text" in accepted[0]!, false)
})
