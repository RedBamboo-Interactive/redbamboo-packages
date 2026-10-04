import test from "node:test"
import assert from "node:assert/strict"
import { shouldAutoFocusComposer } from "./composer-focus.ts"

function ownerWindow(primaryPointerIsCoarse: boolean): Window {
  return {
    matchMedia: (query: string) => ({
      matches: query === "(pointer: coarse)" && primaryPointerIsCoarse,
    }),
  } as Window
}

test("keeps composer autofocus for a fine primary pointer", () => {
  assert.equal(shouldAutoFocusComposer(ownerWindow(false), "desktop-only"), true)
})

test("suppresses passive composer autofocus for a coarse primary pointer", () => {
  assert.equal(shouldAutoFocusComposer(ownerWindow(true), "desktop-only"), false)
})

test("preserves existing autofocus when matchMedia is unavailable", () => {
  assert.equal(shouldAutoFocusComposer({} as Window, "desktop-only"), true)
})

test("always mode focuses for fine and coarse primary pointers", () => {
  assert.equal(shouldAutoFocusComposer(ownerWindow(false), "always"), true)
  assert.equal(shouldAutoFocusComposer(ownerWindow(true), "always"), true)
})

test("never mode suppresses focus for fine and coarse primary pointers", () => {
  assert.equal(shouldAutoFocusComposer(ownerWindow(false), "never"), false)
  assert.equal(shouldAutoFocusComposer(ownerWindow(true), "never"), false)
})
