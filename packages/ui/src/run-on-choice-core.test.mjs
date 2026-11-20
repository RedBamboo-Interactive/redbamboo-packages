import assert from "node:assert/strict"
import { test } from "node:test"
import {
  parseRunOnNodes,
  RUN_ON_AUTOMATIC,
  runOnCompactLabel,
  runOnStatusWords,
  runOnUnavailableReason,
  runOnView,
} from "./components/run-on-choice-core.ts"
import { findUiComponents } from "./component-catalog.ts"

const zero = {
  id: "local", name: "LAURENT-PC", kind: "local", isLocal: true, status: "online", confirmed: true,
  placement: { eligible: true, reason: null },
  capabilities: [{ slug: "tts", status: "Running" }, { slug: "ai-session", status: "Running" }],
}
const remote = (id, name, status, placement, extra = {}) => ({
  id, name, kind: "remote", isLocal: false, status, confirmed: true, placement, capabilities: [], ...extra,
})
const studio = remote("node_01STUDIO", "STUDIO", "online", { eligible: true, reason: null }, { capabilities: [{ slug: "tts" }] })
const laptop = remote("node_01LAPTOP", "LAPTOP", "offline", { eligible: false, reason: "offline" })
const pending = remote("node_01PENDING", "NEW-BOX", "pending-confirmation", { eligible: false, reason: "not_confirmed" }, { confirmed: false })
const revoked = remote("node_01REVOKED", "OLD-BOX", "revoked", { eligible: false, reason: "revoked" })
const phase3 = remote("node_01PHASE3", "TOWER", "online", { eligible: false, reason: "remote_execution_not_available" })

test("the GET /compute/nodes answer is read from its nodes member, malformed items dropped", () => {
  const nodes = parseRunOnNodes({ nodes: [zero, { name: "no id" }, null, laptop], legacyNodeId: "legacy" })
  assert.deepEqual(nodes.map(n => n.id), ["local", "node_01LAPTOP"])
  assert.deepEqual(nodes[0].placement, { eligible: true, reason: null })
  assert.deepEqual(nodes[0].capabilities, [{ slug: "tts" }, { slug: "ai-session" }])
  assert.throws(() => parseRunOnNodes({ error: "nope" }), /expected shape/)
})

test("one node that can run the work is a read-only row", () => {
  const view = runOnView(parseRunOnNodes({ nodes: [zero] }))
  assert.equal(view.mode, "single")
  assert.equal(view.node.name, "LAURENT-PC")
})

test("nodes that cannot run work never turn the row into a picker", () => {
  // Today: node zero plus paired nodes that cannot run work yet, are offline, unconfirmed or revoked.
  const view = runOnView(parseRunOnNodes({ nodes: [zero, phase3, laptop, pending, revoked] }))
  assert.equal(view.mode, "single")
  assert.equal(view.node.id, "local")
})

test("from two runnable nodes up it is a picker: Automatic first, runnable nodes, then the rest disabled with why", () => {
  const view = runOnView(parseRunOnNodes({ nodes: [zero, laptop, studio, pending, revoked, phase3] }))
  assert.equal(view.mode, "picker")
  assert.equal(view.automaticLabel, "Automatic (LAURENT-PC)")
  assert.deepEqual(view.options.map(o => [o.name, o.selectable, o.reason]), [
    ["LAURENT-PC", true, null],
    ["STUDIO", true, null],
    ["LAPTOP", false, "Offline"],
    ["NEW-BOX", false, "Not confirmed by its owner yet"],
    ["OLD-BOX", false, "Revoked"],
    ["TOWER", false, "Cannot run work yet"],
  ])
})

test("the node's own state explains it before the placement verdict", () => {
  // A revoked node that is also unconfirmed and offline says revoked.
  assert.equal(runOnUnavailableReason({ ...revoked, confirmed: false }), "Revoked")
  assert.equal(runOnUnavailableReason({ ...laptop, status: "pending-confirmation", confirmed: false }), "Not confirmed by its owner yet")
  assert.equal(runOnUnavailableReason({ ...laptop, status: "needs-update" }), "Needs an update")
  // An unknown reason code is still shown, in words.
  assert.equal(runOnUnavailableReason(remote("n", "N", "online", { eligible: false, reason: "gpu_busy" })), "Gpu busy")
  assert.equal(runOnUnavailableReason(zero), null)
})

test("a node without the capability is disabled with No <name> here", () => {
  const nodes = parseRunOnNodes({ nodes: [zero, studio] })
  assert.equal(runOnView(nodes, { slug: "tts", name: "Text to speech" }).mode, "picker")
  const view = runOnView(nodes, { slug: "ai-session", name: "Claude Code" })
  assert.equal(view.mode, "single", "only node zero runs it, so there is nothing to choose")
  assert.equal(runOnUnavailableReason(nodes[1], { slug: "ai-session", name: "Claude Code" }), "No Claude Code here")
  assert.equal(runOnUnavailableReason(nodes[1], { slug: "stt" }), "No stt here")
  assert.equal(runOnView([nodes[1]], { slug: "ai-session" }).mode, "none")
})

test("no runnable node says so instead of offering a choice", () => {
  const view = runOnView(parseRunOnNodes({ nodes: [laptop, revoked] }), { slug: "tts", name: "Text to speech" })
  assert.deepEqual(view, { mode: "none", message: "No node can run Text to speech right now" })
})

test("a chosen node that can no longer run the work stays visible, disabled, so the choice is not lost by looking", () => {
  const nodes = parseRunOnNodes({ nodes: [zero, laptop] })
  const view = runOnView(nodes, undefined, "node_01LAPTOP")
  assert.equal(view.mode, "picker")
  assert.deepEqual(view.options.map(o => [o.id, o.selectable]), [["local", true], ["node_01LAPTOP", false]])
  const gone = runOnView(nodes, undefined, "node_01GONE")
  assert.equal(gone.mode, "picker")
  assert.equal(gone.options.at(-1).reason, "No longer listed")
  // Automatic is never a node id.
  assert.ok(!nodes.some(n => n.id === RUN_ON_AUTOMATIC))
})

test("RunOnChoice is discoverable in the component catalog", () => {
  const found = findUiComponents("run-on")[0]
  assert.equal(found?.id, "run-on-choice")
  assert.ok(found.selectors.includes('[data-slot="run-on-choice"]'))
  assert.equal(findUiComponents("placement")[0]?.id, "run-on-choice")
})

test("the node's icon, colour and platform travel to the options; an older RedCompute's list has none", () => {
  const nodes = parseRunOnNodes({ nodes: [
    { ...zero, icon: "desktop-tower", color: "blue", os: "windows" },
    { ...studio, platform: { os: "linux" } },
  ] })
  assert.deepEqual([nodes[0].icon, nodes[0].color, nodes[0].os], ["desktop-tower", "blue", "windows"])
  assert.deepEqual([nodes[1].icon, nodes[1].color, nodes[1].os], [null, null, "linux"])
  const view = runOnView(nodes, { slug: "tts" })
  assert.equal(view.mode, "picker")
  assert.deepEqual(view.options.map(o => [o.id, o.icon, o.color, o.os, o.status]), [
    ["local", "desktop-tower", "blue", "windows", "online"],
    ["node_01STUDIO", null, null, "linux", "online"],
  ])
})

test("the compact control's label names the chosen node and its status", () => {
  const nodes = parseRunOnNodes({ nodes: [zero, studio, laptop] })
  const view = runOnView(nodes, { slug: "tts" })
  assert.equal(runOnCompactLabel(view, null), "Run on: Automatic (LAURENT-PC)")
  assert.equal(runOnCompactLabel(view, "node_01STUDIO"), "Run on: STUDIO (Online)")
  assert.equal(runOnCompactLabel(runOnView(nodes, { slug: "tts" }, "node_01LAPTOP"), "node_01LAPTOP"), "Run on: LAPTOP (Offline)")
  assert.equal(runOnCompactLabel(runOnView(parseRunOnNodes({ nodes: [zero] })), null), "Runs on LAURENT-PC (Online)")
  const none = runOnView(parseRunOnNodes({ nodes: [laptop] }), { slug: "tts", name: "Text to speech" })
  assert.equal(runOnCompactLabel(none, null), "No node can run Text to speech right now")
  assert.equal(runOnStatusWords("needs-update"), "Needs an update")
  assert.equal(runOnStatusWords("some_new_state"), "Some new state")
  assert.equal(runOnStatusWords(null), null)
})
