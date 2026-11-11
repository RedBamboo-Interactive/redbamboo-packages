import assert from "node:assert/strict"
import { afterEach, beforeEach, mock, test } from "node:test"

import {
  DEFAULT_TOAST_DURATION,
  MAX_TOASTS_PER_GROUP,
  MAX_VISIBLE_TOASTS,
  TOAST_EXIT_MS,
  activeToaster,
  dismissToast,
  getToasts,
  pauseToasts,
  registerToaster,
  resetToastsForTests,
  resumeToasts,
  subscribeToasts,
  toast,
  updateToast,
} from "./components/toast-store.ts"

// Stand-ins for two documents: the main page and a detached window.
const main = { name: "main" }
const pip = { name: "pip" }

const phases = () => getToasts().map((t) => `${t.title}:${t.phase}`)
const of = (target) => getToasts().filter((t) => t.target === target)

beforeEach(() => {
  mock.timers.enable({ apis: ["setTimeout", "Date"] })
  resetToastsForTests()
})

afterEach(() => {
  resetToastsForTests()
  mock.timers.reset()
})

test("a toast leaves through a closing phase, then the queue", () => {
  const id = toast({ title: "Saved", variant: "success" }, { document: main })
  assert.deepEqual(phases(), ["Saved:open"])

  dismissToast(id)
  assert.deepEqual(phases(), ["Saved:closing"], "dismiss starts the exit instead of removing")
  dismissToast(id)
  mock.timers.tick(TOAST_EXIT_MS - 1)
  assert.deepEqual(phases(), ["Saved:closing"])
  mock.timers.tick(1)
  assert.deepEqual(phases(), [])
})

test("the timeout takes the same exit as a dismissal", () => {
  toast({ title: "Copied", variant: "default" }, { document: main })
  toast({ title: "Quick", variant: "default", duration: 1000 }, { document: main })
  mock.timers.tick(1000)
  assert.deepEqual(phases(), ["Copied:open", "Quick:closing"])
  mock.timers.tick(DEFAULT_TOAST_DURATION - 1000)
  assert.deepEqual(phases(), ["Copied:closing"])
})

test("a loading toast waits until it is updated out of loading", () => {
  const id = toast({ title: "Preparing", variant: "loading" }, { document: main })
  mock.timers.tick(60_000)
  assert.deepEqual(phases(), ["Preparing:open"])

  updateToast(id, { title: "Sent", variant: "success" })
  assert.deepEqual(phases(), ["Sent:open"])
  mock.timers.tick(DEFAULT_TOAST_DURATION)
  assert.deepEqual(phases(), ["Sent:closing"])

  updateToast(id, { title: "Too late" })
  assert.equal(getToasts()[0].title, "Sent", "a closing toast is no longer updated")
})

test("each toast is addressed to its document", () => {
  toast({ title: "Main", variant: "default" }, { document: main })
  toast({ title: "Float", variant: "default" }, { document: pip })
  assert.deepEqual(of(main).map((t) => t.title), ["Main"])
  assert.deepEqual(of(pip).map((t) => t.title), ["Float"])
  assert.equal(toast({ title: "Server side", variant: "default" }), getToasts().at(-1).id)
  assert.equal(getToasts().at(-1).target, null, "without a DOM the default target is null")
})

test("a group shows three toasts, then one +N more toast that keeps counting", () => {
  for (let i = 1; i <= MAX_TOASTS_PER_GROUP + 3; i++) {
    toast({ title: `Run ${i}`, variant: "default", group: "codered", groupLabel: "Code" }, { document: main })
  }
  assert.deepEqual(of(main).map((t) => t.title), ["Run 1", "Run 2", "Run 3", "+3 more from Code"])

  // The same group in another window has its own allowance.
  toast({ title: "Float run", variant: "default", group: "codered" }, { document: pip })
  assert.deepEqual(of(pip).map((t) => t.title), ["Float run"])

  // Once the overflow toast has gone, a later burst starts a fresh count.
  const overflow = of(main).at(-1)
  dismissToast(overflow.id)
  mock.timers.tick(TOAST_EXIT_MS)
  toast({ title: "Run 7", variant: "default", group: "codered", groupLabel: "Code" }, { document: main })
  assert.equal(of(main).at(-1).title, "+1 more from Code")
})

test("a group's overflow toast stays while arrivals keep coming", () => {
  for (let i = 0; i < MAX_TOASTS_PER_GROUP + 1; i++) toast({ title: `n${i}`, variant: "default", group: "g", duration: 60_000 }, { document: main })
  const overflowId = of(main).at(-1).id
  mock.timers.tick(DEFAULT_TOAST_DURATION - 100)
  toast({ title: "late", variant: "default", group: "g" }, { document: main })
  mock.timers.tick(200)
  const overflow = of(main).find((t) => t.id === overflowId)
  assert.equal(overflow.phase, "open", "a new arrival restarts the overflow timeout")
  assert.equal(overflow.title, "+2 more from g")
})

test("at most five toasts show per document; the oldest open one makes room", () => {
  const loading = toast({ title: "Upload", variant: "loading" }, { document: main })
  for (let i = 1; i <= MAX_VISIBLE_TOASTS; i++) toast({ title: `T${i}`, variant: "default" }, { document: main })
  toast({ title: "Elsewhere", variant: "default" }, { document: pip })

  assert.deepEqual(
    of(main).map((t) => `${t.title}:${t.phase}`),
    ["Upload:open", "T1:closing", "T2:open", "T3:open", "T4:open", "T5:open"],
    "the loading toast is tracking work and is never pushed out",
  )
  assert.equal(of(main).find((t) => t.id === loading).phase, "open")
  assert.deepEqual(of(pip).map((t) => t.phase), ["open"])
})

test("pausing a document holds its timeouts and resuming continues them", () => {
  toast({ title: "Main", variant: "default", duration: 1000 }, { document: main })
  toast({ title: "Float", variant: "default", duration: 1000 }, { document: pip })
  mock.timers.tick(600)
  pauseToasts(main)
  toast({ title: "Arrived while paused", variant: "default", duration: 1000 }, { document: main })
  mock.timers.tick(5000)
  assert.deepEqual(phases(), ["Main:open", "Float:closing", "Arrived while paused:open"])

  resumeToasts(main)
  mock.timers.tick(399)
  assert.equal(of(main)[0].phase, "open")
  mock.timers.tick(1)
  assert.equal(of(main)[0].phase, "closing", "it had 400 ms left when the pointer arrived")
  mock.timers.tick(600)
  assert.equal(of(main).find((t) => t.title === "Arrived while paused").phase, "closing", "a toast raised while paused starts its full timeout on resume")
})

test("one toaster renders per document; a second mount stays silent", () => {
  const warn = mock.method(console, "warn", () => {})
  const shell = Symbol("shell")
  const plugin = Symbol("plugin")
  const float = Symbol("float")
  let notified = 0
  const unsubscribe = subscribeToasts(() => notified++)

  const offShell = registerToaster(main, shell)
  const offPlugin = registerToaster(main, plugin)
  registerToaster(pip, float)
  assert.equal(activeToaster(main), shell)
  assert.equal(activeToaster(pip), float)
  assert.equal(warn.mock.callCount(), 1)
  assert.ok(notified >= 3, "registration changes notify subscribers")

  offPlugin()
  assert.equal(activeToaster(main), shell, "removing the silent one changes nothing")
  offShell()
  assert.equal(activeToaster(main), undefined)

  unsubscribe()
  warn.mock.restore()
})
