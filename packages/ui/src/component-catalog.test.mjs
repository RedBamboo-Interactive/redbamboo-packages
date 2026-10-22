import assert from "node:assert/strict"
import { test } from "node:test"
import { findUiComponents, UI_COMPONENT_CATALOG } from "./component-catalog.ts"

test("the entity card is discoverable by domain, behavior, and AI-native intent", () => {
  assert.equal(findUiComponents("entity")[0]?.id, "entity-card")
  assert.equal(findUiComponents("avatar")[0]?.id, "entity-card")
  assert.equal(findUiComponents("ai-native")[0]?.id, "entity-card")
})

test("the entity card catalog documents its stable machine selectors", () => {
  const card = UI_COMPONENT_CATALOG.find((component) => component.id === "entity-card")
  assert.ok(card)
  assert.ok(card.selectors.includes('[data-slot="entity-card"]'))
  assert.ok(card.selectors.includes('[data-slot="entity-card-open"]'))
  assert.ok(card.exports.includes("queryEntityCards"))
  assert.ok(card.exports.includes("EntityInteractionProvider"))
  assert.ok(card.exports.includes("EntityPresentationProvider"))
  assert.ok(card.exports.includes("useEntityCardPresentation"))
  assert.ok(card.selectors.includes('[data-entity-action="inspect"]'))
  assert.ok(card.selectors.includes('[data-entity-width]'))
  assert.ok(card.selectors.includes('[data-inspected]'))
  assert.ok(card.variants.includes("width:quarter"))
  assert.ok(card.variants.includes("width:half"))
  assert.ok(card.variants.includes("width:full"))
})

test("floating surfaces are discoverable with stable activation selectors", () => {
  const surface = findUiComponents("always-on-top")[0]
  assert.equal(surface?.id, "floating-surface")
  assert.ok(surface?.selectors.includes('[data-slot="floating-surface-trigger"]'))
  assert.ok(surface?.exports.includes("runUiSurfaceAction"))
})

test("sheet and media viewer are discoverable with their composition selectors", () => {
  const sheet = findUiComponents("bottom-sheet")[0]
  assert.equal(sheet?.id, "sheet")
  assert.ok(sheet?.selectors.includes('[data-slot="sheet"]'))
  assert.ok(sheet?.variants.includes("side:bottom"))

  const viewer = findUiComponents("zoom")[0]
  assert.equal(viewer?.id, "media-viewer")
  assert.ok(viewer?.exports.includes("MediaViewer"))
  assert.ok(viewer?.selectors.includes('[data-slot="media-viewer-desktop-panel"]'))
  assert.ok(viewer?.selectors.includes('[data-slot="media-viewer-action-row"]'))
})

test("the entity picker is the discoverable answer for entity references and pickers", () => {
  assert.equal(findUiComponents("picker")[0]?.id, "entity-picker")
  assert.equal(findUiComponents("EntityRefField")[0]?.id, "entity-picker")
  assert.equal(findUiComponents("relation")[0]?.id, "entity-picker")
  // The card stays the first answer for plain entity identity.
  assert.equal(findUiComponents("entity")[0]?.id, "entity-card")
})

test("the entity picker catalog documents its host contract and machine selectors", () => {
  const picker = UI_COMPONENT_CATALOG.find((component) => component.id === "entity-picker")
  assert.ok(picker)
  for (const name of ["EntityRefField", "EntityRefListField", "EntityPickerDialog", "EntityPickerProvider"])
    assert.ok(picker.exports.includes(name), name)
  assert.ok(picker.avoidWhen.some((rule) => /inside the design system/.test(rule)))
  assert.ok(picker.avoidWhen.some((rule) => /Hand-rolling an EntityCard list/.test(rule)))
  for (const selector of [
    '[data-slot="entity-ref-field"]',
    '[data-slot="entity-ref-empty"]',
    '[data-slot="entity-ref-change"]',
    '[data-slot="entity-ref-clear"]',
    '[data-slot="entity-picker-search"]',
    '[data-slot="entity-picker-list"]',
    '[data-slot="entity-picker-done"]',
  ]) assert.ok(picker.selectors.includes(selector), selector)
  assert.deepEqual([...picker.variants].sort(), ["audio-preview", "multiple", "single"])
  assert.ok(picker.exports.includes("EntityPickerSourceOverride"))
  assert.ok(picker.useWhen.some((rule) => /per-field `source` override/.test(rule)))
  assert.ok(picker.selectors.includes('[data-slot="entity-picker-announcer"]'))
})

test("every catalog export is exported by the package entry", async () => {
  const { readFile } = await import("node:fs/promises")
  const index = await readFile(new URL("./index.ts", import.meta.url), "utf8")
  for (const component of UI_COMPONENT_CATALOG.filter((entry) => entry.packageName === "@redbamboo/ui"))
    for (const name of component.exports)
      assert.match(index, new RegExp(`\\b${name}\\b`), `${component.id}: ${name}`)
})
