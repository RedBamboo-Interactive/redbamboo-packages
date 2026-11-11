import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

const toastSource = readFileSync(new URL("./components/toast.tsx", import.meta.url), "utf8")
const storeSource = readFileSync(new URL("./components/toast-store.ts", import.meta.url), "utf8")
const tokens = readFileSync(new URL("./tokens.css", import.meta.url), "utf8")

test("toaster keeps equal mobile gutters and a bounded desktop width", () => {
  assert.match(toastSource, /fixed bottom-4 left-4 right-4/)
  assert.match(toastSource, /sm:left-auto sm:max-w-sm/)
  assert.doesNotMatch(toastSource, /right-4 z-\[100\] flex flex-col gap-2 max-w-sm/)
})

test("toaster portals out of the subtree that mounts it", () => {
  // Rendering inline put a plugin's stack inside the plugin's CSS scope (Nova's landed bottom-left).
  assert.match(toastSource, /createPortal\(/)
  assert.match(toastSource, /portalContainer,\s*\)/)
})

test("ToastProvider no longer creates a queue or a stack", () => {
  const provider = toastSource.match(/export function ToastProvider[\s\S]*?\n}\n/)?.[0] ?? ""
  assert.match(provider, /return <>\{children\}<\/>/)
  assert.doesNotMatch(toastSource, /createContext/)
})

test("stack spacing lives inside each slot so a collapsing toast leaves no gap", () => {
  assert.doesNotMatch(toastSource, /flex flex-col gap-/)
  assert.match(toastSource, /rb-toast-clip[\s\S]*?className="pt-2"/)
})

test("exit motion fits inside the store's removal delay", () => {
  const exitMs = Number(storeSource.match(/TOAST_EXIT_MS = (\d+)/)?.[1])
  const out = Number(tokens.match(/\[data-phase="closing"\] \.rb-toast \{\s*animation: rb-toast-out (\d+)ms/)?.[1])
  const collapse = tokens.match(/\[data-phase="closing"\] \{[^}]*animation: rb-toast-collapse (\d+)ms [^)]+\) (\d+)ms/)
  assert.ok(exitMs && out && collapse, "toast exit timings are declared")
  assert.ok(out <= Number(collapse[2]), "the toast is gone before its slot collapses")
  assert.ok(Number(collapse[2]) + Number(collapse[1]) <= exitMs, "the collapse finishes before removal")
})

test("reduced motion keeps only a fade", () => {
  const reduced = tokens.slice(tokens.indexOf("/* ── Toast motion"), tokens.indexOf("/* ── Sheet and media-viewer motion"))
  assert.match(reduced, /prefers-reduced-motion: reduce[\s\S]*--rb-toast-shift: 0px;[\s\S]*--rb-toast-scale: 1;/)
})
