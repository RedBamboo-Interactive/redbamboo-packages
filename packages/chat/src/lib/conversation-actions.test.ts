import assert from "node:assert/strict"
import test from "node:test"
import type { ContextMenuEntry } from "@redbamboo/ui"
import { CONVERSATION_SHORTCUTS, conversationActionEntries, conversationShortcut } from "./conversation-actions.ts"
import { conversationCommandSpecs } from "./conversation-commands.ts"

const noop = () => {}
const ids = (entries: ContextMenuEntry[]) => entries.map((entry) => entry.id)
const items = (entries: ContextMenuEntry[]) => entries.flatMap((entry) => ("separator" in entry ? [] : [entry]))

test("one shortcut map for every host", () => {
  assert.deepEqual(CONVERSATION_SHORTCUTS, {
    info: "Alt+I", artifacts: "Alt+A", rename: "Alt+R", updateTitle: "Alt+T", share: "Alt+S", close: "Alt+W",
  })
})

test("fixed order: leading, Info, Artifacts, Rename, Update title, Share, after-Share, Stop, trailing, Close alone", () => {
  const entries = conversationActionEntries({
    leading: [{ id: "host-leading", label: "Lead" }],
    onInfo: noop, onArtifacts: noop, onRename: noop, onUpdateTitle: noop, onShare: noop,
    afterShare: [{ id: "host-after-share", label: "After share" }],
    onStop: noop,
    trailing: [{ id: "host-trailing", label: "Trail" }],
    onClose: noop,
  })
  assert.deepEqual(ids(entries), [
    "host-leading", "info", "artifacts", "rename", "update-title", "share", "host-after-share", "stop", "host-trailing", "close-separator", "close",
  ])
  const close = entries.at(-1)!
  assert.ok(!("separator" in close) && close.danger)
})

test("only handlers that exist become items; Info is always there", () => {
  assert.deepEqual(ids(conversationActionEntries({ onInfo: noop })), ["info"])
  assert.deepEqual(ids(conversationActionEntries({ onInfo: noop, onArtifacts: noop, onClose: noop })), ["info", "artifacts", "close-separator", "close"])
})

test("shortcuts are advertised only for the open conversation", () => {
  const all = { onInfo: noop, onArtifacts: noop, onRename: noop, onUpdateTitle: noop, onShare: noop, onStop: noop, onClose: noop }
  assert.deepEqual(items(conversationActionEntries(all)).map((entry) => entry.shortcut), [undefined, undefined, undefined, undefined, undefined, undefined, undefined])
  assert.deepEqual(items(conversationActionEntries({ ...all, showShortcuts: true })).map((entry) => entry.shortcut), [
    "Alt+I", "Alt+A", "Alt+R", "Alt+T", "Alt+S", undefined, "Alt+W",
  ])
  assert.equal(conversationShortcut("Alt+V", true), "Alt+V")
  assert.equal(conversationShortcut("Alt+V", false), undefined)
})

test("labels and icons stay the ones the menus have always shown", () => {
  const entries = items(conversationActionEntries({ onInfo: noop, onArtifacts: noop, onRename: noop, onUpdateTitle: noop, onShare: noop, onStop: noop, onClose: noop }))
  assert.deepEqual(entries.map((entry) => [entry.label, entry.icon]), [
    ["Info", "ph-bold ph-info"],
    ["Artifacts", "ph-bold ph-squares-four"],
    ["Rename", "ph-bold ph-pen"],
    ["Update title", "ph-bold ph-sparkle"],
    ["Share", "ph-bold ph-share-network"],
    ["Stop", "ph-bold ph-stop"],
    ["Close", "ph-bold ph-x"],
  ])
})

test("a pending title update disables the item and spins its icon", () => {
  const [item] = items(conversationActionEntries({ onInfo: noop, onUpdateTitle: noop, updateTitlePending: true })).filter((entry) => entry.id === "update-title")
  assert.equal(item!.disabled, true)
  assert.match(item!.icon ?? "", /animate-spin/)
  assert.deepEqual(item!.attributes, { "aria-busy": true })
})

test("items run their handlers synchronously", () => {
  const ran: string[] = []
  const entries = conversationActionEntries({
    onInfo: () => { ran.push("info") }, onShare: () => { ran.push("share") }, onClose: () => { ran.push("close") },
  })
  for (const entry of items(entries)) assert.equal(entry.run?.({} as never), undefined)
  assert.deepEqual(ran, ["info", "share", "close"])
})

test("command specs: six standard commands in one order, keys from the shared map, ids from the host", () => {
  const specs = conversationCommandSpecs({
    idPrefix: "session", group: "Sessions", noun: "Session",
    info: { action: noop }, share: { action: noop, enabled: false }, close: { action: noop, id: "close-session" },
  })
  assert.deepEqual(specs.map((spec) => [spec.id, spec.shortcut, spec.enabled]), [
    ["session-info", "Alt+I", true],
    ["session-artifacts", "Alt+A", false],
    ["session-rename", "Alt+R", false],
    ["session-update-title", "Alt+T", false],
    ["session-share", "Alt+S", false],
    ["close-session", "Alt+W", true],
  ])
  assert.deepEqual(specs.map((spec) => spec.label), [
    "Session Info", "Toggle Artifacts", "Rename Session", "Update Session Title", "Share Session", "Close Session",
  ])
  assert.ok(specs.every((spec) => spec.group === "Sessions"))
})

test("command specs: a host keeps its own wording", () => {
  const [info] = conversationCommandSpecs({
    idPrefix: "nova-discussion", group: "Discussions", noun: "Discussion",
    info: { action: noop, description: "Show the session, model and delegations of the open discussion" },
  })
  assert.equal(info!.id, "nova-discussion-info")
  assert.equal(info!.label, "Discussion Info")
  assert.equal(info!.description, "Show the session, model and delegations of the open discussion")
})
