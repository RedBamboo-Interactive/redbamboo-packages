import assert from "node:assert/strict"
import test from "node:test"
import { createLocalStore } from "./local-store.ts"

test("same-document stores sharing a key observe one another", { concurrency: false }, () => {
  const values = new Map<string, string>()
  const browserWindow = new EventTarget()
  Object.defineProperty(globalThis, "window", { configurable: true, value: browserWindow })
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    },
  })

  try {
    const first = createLocalStore("shared-setting", { key: "F13" })
    const second = createLocalStore("shared-setting", { key: "F13" })
    assert.equal(second.get().key, "F13")
    let notifications = 0
    const unsubscribe = second.subscribe(() => notifications++)

    first.set({ key: "F14" })

    assert.equal(notifications, 1)
    assert.equal(second.get().key, "F14")
    unsubscribe()
  } finally {
    Reflect.deleteProperty(globalThis, "window")
    Reflect.deleteProperty(globalThis, "localStorage")
  }
})
