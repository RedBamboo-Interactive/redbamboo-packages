import { test } from "node:test"
import assert from "node:assert/strict"
import { formatContextSize, MESSAGE_CONTEXT_BLOCK_KEY, parseMessageContextBlock } from "./message-context.ts"

// Shaped like Nova's NovaContextBuilder output (its golden full and delta contexts).
const FULL = `<nova-context timestamp="2026-10-24T14:30:00Z" day="Saturday" device="Pixel 9" device_type="phone" platform="android" input="text" discussion="c0ffee01" message="5d1f" agent="Nova" room="Living &quot;room&quot;">
Mood: Curious, a little tired
Active discussions:
- [c0ffee01] "Plan v2" . 12 msgs . 5min ago <- you are here
- [LIVE][live0001] "Live · 2026-10-24" . 40 msgs . 1min ago

Recently archived:
- [old00001] "Archived notes" . 8 msgs . archived 3d ago

Recall any discussion: curl -s http://127.0.0.1:18804/api/apps/nova/discussions/{id}/export
Search all discussions: curl -s "http://127.0.0.1:18804/api/apps/nova/discussions/search?q={query}"

Recent LIVE events:
- [automation] Morning brief completed (8min ago)
- [discussion] Laurent in "Plan v2": can we ship today? (6min ago)

Installed extension context:
- [mail] Mail connected (l***@example.com): 3 unread in Inbox.
- [presence] Laurent is home (Living room)

Reactions since your last message:
- Laurent reacted 👍 to your latest message: "Shipped"

You're wearing "Navy evening" today (navy hoodie, grey jeans, white sneakers, silver ring). You chose it because: rain.
See it: http://127.0.0.1:18804/api/assets/outfit.png

Working in worktree: nova · main at T:/Projects/nova

When a reaction or nothing at all says it better than words, make your entire reply exactly <nova-no-reply/>: the turn then ends with no visible message.
</nova-context>`

const DELTA = `<nova-context timestamp="2026-10-24T14:30:00Z" day="Saturday" device="Desktop" input="text" discussion="c0ffee01">
Changes since last message:
- 2 new messages in [c0ffee01] "Plan v2"
- Outfit changed: You're wearing "Gym" today (black leggings, grey top).
- [automation] Nightly build passed
Working in worktree: nova · main at T:/Projects/nova
</nova-context>
<nova-prior-message role="assistant">
Shall I book the train?
Line two.
</nova-prior-message>
`

test("the shared key is the one Nova stores", () => {
  assert.equal(MESSAGE_CONTEXT_BLOCK_KEY, "novaContextBlock")
})

test("a full context splits into its named sections, the ones that matter first, outfit folded", () => {
  const view = parseMessageContextBlock(FULL)!

  assert.deepEqual(view.sections.map(s => [s.kind, s.title, s.collapsed]), [
    ["live-events", "Recent LIVE events", false],
    ["extensions", "Installed extension context", false],
    ["reactions", "Reactions since your last message", false],
    ["heading", "Active discussions", false],
    ["heading", "Recently archived", false],
    ["outfit", "Outfit", true],
    ["other", "Other", false],
  ])
  const byKind = Object.fromEntries(view.sections.map(s => [s.title, s.lines]))
  assert.deepEqual(byKind["Recent LIVE events"], [
    "- [automation] Morning brief completed (8min ago)",
    "- [discussion] Laurent in \"Plan v2\": can we ship today? (6min ago)",
  ])
  assert.deepEqual(byKind["Installed extension context"], [
    "- [mail] Mail connected (l***@example.com): 3 unread in Inbox.",
    "- [presence] Laurent is home (Living room)",
  ])
  assert.deepEqual(byKind["Outfit"], [
    "You're wearing \"Navy evening\" today (navy hoodie, grey jeans, white sneakers, silver ring). You chose it because: rain.",
    "See it: http://127.0.0.1:18804/api/assets/outfit.png",
  ])
  assert.deepEqual(byKind["Other"], [
    "Mood: Curious, a little tired",
    "",
    "Recall any discussion: curl -s http://127.0.0.1:18804/api/apps/nova/discussions/{id}/export",
    "Search all discussions: curl -s \"http://127.0.0.1:18804/api/apps/nova/discussions/search?q={query}\"",
    "",
    "Working in worktree: nova · main at T:/Projects/nova",
    "",
    "When a reaction or nothing at all says it better than words, make your entire reply exactly <nova-no-reply/>: the turn then ends with no visible message.",
  ])
  assert.equal(view.raw, FULL)
})

test("every line of the context lands in exactly one section", () => {
  for (const text of [FULL, DELTA]) {
    const view = parseMessageContextBlock(text)!
    const body = text.slice(text.indexOf(">") + 1, text.indexOf("</nova-context>"))
    const expected = body.split("\n").map(l => l.trimEnd()).filter(l => l.trim() !== "")
    const headings = view.sections.filter(s => s.kind !== "other" && s.kind !== "outfit" && s.kind !== "prior-message"
      && !(s.lines.length === 1 && s.lines[0].startsWith("No context changes")))
    const seen = view.sections.filter(s => s.kind !== "prior-message").flatMap(s => s.lines).filter(l => l !== "")
      .map(l => l.startsWith("Outfit changed: ") ? `- ${l}` : l)
    assert.equal(seen.length + headings.length, expected.length, "no line lost or duplicated")
  }
})

test("a delta shows its changes, folds the outfit change and the prior message", () => {
  const view = parseMessageContextBlock(DELTA)!

  assert.deepEqual(view.sections.map(s => [s.kind, s.collapsed]), [
    ["changes", false], ["outfit", true], ["prior-message", true], ["other", false],
  ])
  assert.deepEqual(view.sections[0].lines, [
    "- 2 new messages in [c0ffee01] \"Plan v2\"",
    "- [automation] Nightly build passed",
  ])
  assert.deepEqual(view.sections[1].lines, ["Outfit changed: You're wearing \"Gym\" today (black leggings, grey top)."])
  assert.deepEqual(view.sections[2].lines, ["Shall I book the train?", "Line two."])
  assert.deepEqual(view.sections[3].lines, ["Working in worktree: nova · main at T:/Projects/nova"])
})

test("a long discussion list starts folded", () => {
  const list = Array.from({ length: 9 }, (_, i) => `- [d${i}] "Item ${i}" . 1 msgs . 1min ago`).join("\n")
  const view = parseMessageContextBlock(`<nova-context discussion="x">
Active discussions:
${list}

Recently archived:
- [a] "Old" . 2 msgs . archived 1d ago
</nova-context>`)!

  assert.deepEqual(view.sections.map(s => [s.title, s.collapsed]), [["Active discussions", true], ["Recently archived", false]])
})

test("no changes reads as its own changes section", () => {
  const view = parseMessageContextBlock(`<nova-context discussion="x">\nNo context changes since last message.\n</nova-context>`)!

  assert.deepEqual(view.sections, [{
    kind: "changes", title: "Changes since last message", lines: ["No context changes since last message."], collapsed: false,
  }])
})

test("opening-tag attributes are read and unescaped", () => {
  const view = parseMessageContextBlock(FULL)!

  assert.equal(view.attrs.device, "Pixel 9")
  assert.equal(view.attrs.device_type, "phone")
  assert.equal(view.attrs.room, "Living \"room\"")
})

test("text without a context tag is not a context", () => {
  assert.equal(parseMessageContextBlock(""), null)
  assert.equal(parseMessageContextBlock("hello <nova-contextual>"), null)
})

test("sizes read in bytes then kilobytes", () => {
  assert.equal(formatContextSize("abc"), "3 B")
  assert.equal(formatContextSize("é".repeat(1024)), "2.0 KB")
})
