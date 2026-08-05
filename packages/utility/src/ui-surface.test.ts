import assert from "node:assert/strict"
import { test } from "node:test"
import {
  getUiSurface,
  listUiSurfaces,
  registerUiSurface,
  runUiSurfaceAction,
  type UiSurfaceSnapshot,
} from "./ui-surface.ts"

function snapshot(state: UiSurfaceSnapshot["state"]): UiSurfaceSnapshot {
  return {
    id: "test:floating",
    owner: "test",
    name: "Test surface",
    description: "Test",
    kind: "document-picture-in-picture",
    supported: true,
    state,
    requiresUserActivation: true,
    commandId: "test:float",
    actions: ["open", "close"],
  }
}

test("UI surfaces are queryable and actions return structured state", async () => {
  let state: UiSurfaceSnapshot["state"] = "closed"
  const unregister = registerUiSurface("test:floating", {
    getSnapshot: () => snapshot(state),
    runAction: async (action) => {
      if (action === "open") {
        state = "open"
        return { ok: true, state }
      }
      return { ok: false, state, error: { code: "unsupported_action", message: action } }
    },
  })

  assert.equal(getUiSurface("test:floating")?.commandId, "test:float")
  assert.equal(listUiSurfaces().some((surface) => surface.id === "test:floating"), true)
  assert.deepEqual(await runUiSurfaceAction("test:floating", "open"), { ok: true, state: "open" })

  unregister()
  assert.equal(getUiSurface("test:floating"), undefined)
})

test("unknown surfaces fail explicitly", async () => {
  const result = await runUiSurfaceAction("missing:surface", "open")
  assert.equal(result.ok, false)
  assert.equal(result.error?.code, "surface_not_registered")
})
