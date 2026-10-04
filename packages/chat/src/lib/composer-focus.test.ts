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
  assert.equal(shouldAutoFocusComposer(ownerWindow(false)), true)
})

test("suppresses passive composer autofocus for a coarse primary pointer", () => {
  assert.equal(shouldAutoFocusComposer(ownerWindow(true)), false)
})

test("preserves existing autofocus when matchMedia is unavailable", () => {
  assert.equal(shouldAutoFocusComposer({} as Window), true)
})
