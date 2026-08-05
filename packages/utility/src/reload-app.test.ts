import assert from "node:assert/strict"
import test from "node:test"
import { buildAppReloadUrl } from "./reload-app.ts"

test("buildAppReloadUrl preserves the route and existing query", () => {
  assert.equal(
    buildAppReloadUrl("https://redleaf.example/apps/nova/chat/abc?panel=open#latest", 42),
    "https://redleaf.example/apps/nova/chat/abc?panel=open&_reload=42#latest",
  )
})

test("buildAppReloadUrl replaces an older reload token", () => {
  assert.equal(
    buildAppReloadUrl("https://redleaf.example/apps/nova/chat/abc?_reload=old", "new"),
    "https://redleaf.example/apps/nova/chat/abc?_reload=new",
  )
})
