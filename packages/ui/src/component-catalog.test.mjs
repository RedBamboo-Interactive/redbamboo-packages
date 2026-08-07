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
