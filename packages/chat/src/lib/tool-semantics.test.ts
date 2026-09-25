import assert from "node:assert/strict"
import test from "node:test"
import { getEffectiveToolName, getToolActivityCategory } from "./tool-semantics.ts"

const shell = (command: string) => JSON.stringify({ command, description: "C:\\repo" })

test("classifies Codex PowerShell reads as Read", () => {
  assert.equal(getEffectiveToolName("Bash", shell("Get-Content -Raw memory/index.md")), "Read")
  assert.equal(getEffectiveToolName("Bash", shell("$p='a.ts'; $lines=Get-Content $p; $lines[40..60]")), "Read")
})

test("classifies Codex shell searches and listings", () => {
  assert.equal(getEffectiveToolName("Bash", shell("rg -n 'needle' src")), "Grep")
  assert.equal(getEffectiveToolName("PowerShell", shell("Get-ChildItem -Recurse -Filter *.tsx")), "Glob")
  assert.equal(getEffectiveToolName("Bash", shell("rg --files src")), "Glob")
})

test("keeps mixed or mutating commands in the shell category", () => {
  assert.equal(getEffectiveToolName("Bash", shell("Get-Content a.txt; Set-Content b.txt x")), "Bash")
  assert.equal(getEffectiveToolName("PowerShell", shell("Get-Content a.txt > b.txt")), "PowerShell")
})

test("leaves first-class and malformed tool calls unchanged", () => {
  assert.equal(getEffectiveToolName("Read", JSON.stringify({ file_path: "a.ts" })), "Read")
  assert.equal(getEffectiveToolName("Bash", "not json"), "Bash")
})

test("classifies agent and namespaced native tools without hiding their names", () => {
  assert.equal(getToolActivityCategory("agent:Game Master"), "agent")
  assert.equal(getToolActivityCategory("roleplay_channel_read"), "read-only")
  assert.equal(getToolActivityCategory("roleplay_memory_search"), "read-only")
  assert.equal(getToolActivityCategory("roleplay_message_edit"), "mutating")
  assert.equal(getToolActivityCategory("roleplay_visual_generate"), "mutating")
  assert.equal(getToolActivityCategory("roleplay_memory_upsert"), "mutating")
  assert.equal(getEffectiveToolName("roleplay_message_edit"), "roleplay_message_edit")
})
