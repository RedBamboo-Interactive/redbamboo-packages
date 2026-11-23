import assert from "node:assert/strict"
import test from "node:test"
import type { MessageBlock, MessagePart } from "../types.ts"
import { deriveOpenedMemory, deriveUsedSkills, skillKey, withoutPaths } from "./session-info-usage.ts"

function call(toolName: string, input: Record<string, unknown>): MessagePart {
  return { type: "tool_use", content: "", toolName, toolInput: JSON.stringify(input) }
}

function blocks(...parts: MessagePart[]): MessageBlock[] {
  return [{ id: "m1", role: "assistant", parts, timestamp: "2026-11-23T10:00:00Z" } as MessageBlock]
}

test("skills: Claude Skill calls are counted per skill, most used first", () => {
  const used = deriveUsedSkills(blocks(
    call("Skill", { skill: "playwright-testing" }),
    call("Skill", { skill: "red-suite" }),
    call("Skill", { skill: "red-suite" }),
  ))
  assert.deepEqual(used, [
    { name: "red-suite", count: 2 },
    { name: "playwright-testing", count: 1 },
  ])
})

test("skills: opening a SKILL.md counts as using the skill, with either slash", () => {
  const used = deriveUsedSkills(blocks(
    call("Read", { file_path: "L:\\Workspaces\\Nova\\.claude\\skills\\red-suite\\SKILL.md" }),
    call("Bash", { command: "Get-Content L:/Workspaces/Nova/.agents/skills/delegation/SKILL.md" }),
    call("Read", { file_path: "L:/Workspaces/Nova/.claude/skills/red-suite/references/notes.md" }),
  ))
  assert.deepEqual(used.map(skill => skill.name).sort(), ["delegation", "red-suite"])
  assert.equal(used.find(skill => skill.name === "red-suite")?.count, 1)
})

test("skills: spellings of one skill share a count, and other tools are ignored", () => {
  const used = deriveUsedSkills(blocks(
    call("Skill", { skill: "Chat Stability" }),
    call("Skill", { skill: "chat-stability" }),
    call("Read", { file_path: "src/index.ts" }),
    { type: "text", content: "skills/fake/SKILL.md" },
  ))
  assert.equal(used.length, 1)
  assert.equal(used[0]?.count, 2)
  assert.equal(skillKey("Chat Stability"), "chat-stability")
})

test("skills: a placeholder, a search or a write that mentions a SKILL.md is not using the skill", () => {
  const used = deriveUsedSkills(blocks(
    call("Bash", { command: "echo 'see skills/<name>/SKILL.md'" }),
    call("Grep", { pattern: "x", path: "L:/Workspaces/Nova/.claude/skills/red-suite/SKILL.md" }),
    call("Write", { file_path: "L:/Workspaces/Nova/.claude/skills/red-suite/SKILL.md", content: "x" }),
    call("Read", { file_path: "skills/<name>/SKILL.md" }),
  ))
  assert.deepEqual(used, [])
})

test("skills: a conversation with no tool calls used none", () => {
  assert.deepEqual(deriveUsedSkills([]), [])
})

test("memory: reads, edits and searches under memory/ are told apart", () => {
  const opened = deriveOpenedMemory(blocks(
    call("Read", { file_path: "L:\\Workspaces\\Nova\\memory\\meta\\operating-reference.md" }),
    call("Grep", { pattern: "catalogue", path: "L:/Workspaces/Nova/memory/catalogue.md" }),
    call("Edit", { file_path: "L:/Workspaces/Nova/memory/dreaming/mood.md", old_string: "a", new_string: "b" }),
    call("Read", { file_path: "L:/Workspaces/Nova/src/app.ts" }),
  ))
  assert.deepEqual(opened, [
    { path: "memory/meta/operating-reference.md", accesses: ["read"], count: 1 },
    { path: "memory/catalogue.md", accesses: ["searched"], count: 1 },
    { path: "memory/dreaming/mood.md", accesses: ["edited"], count: 1 },
  ])
})

test("memory: one note read twice and then edited keeps both accesses in one row", () => {
  const opened = deriveOpenedMemory(blocks(
    call("Read", { file_path: "memory/index.md" }),
    call("Read", { file_path: "memory/index.md" }),
    call("Write", { file_path: "memory/index.md", content: "x" }),
  ))
  assert.equal(opened.length, 1)
  assert.deepEqual(opened[0], { path: "memory/index.md", accesses: ["read", "edited"], count: 3 })
})

test("memory: a Glob names the folder it searched, a lookalike folder is not memory", () => {
  const opened = deriveOpenedMemory(blocks(
    call("Glob", { pattern: "memory/topics/*.md" }),
    call("Read", { file_path: "L:/Workspaces/Nova/notmemory/x.md" }),
    call("Read", { file_path: "L:/Workspaces/Nova/memorybank/x.md" }),
  ))
  assert.deepEqual(opened, [{ path: "memory/topics", accesses: ["searched"], count: 1 }])
})

test("memory: Codex shell reads and searches count, a shell write does not", () => {
  const opened = deriveOpenedMemory(blocks(
    call("powershell", { command: "Get-Content L:\\Workspaces\\Nova\\memory\\catalogue.md" }),
    call("powershell", { command: "rg -n mood L:/Workspaces/Nova/memory/dreaming" }),
    call("powershell", { command: "Set-Content memory/index.md 'x'" }),
  ))
  assert.deepEqual(opened, [
    { path: "memory/catalogue.md", accesses: ["read"], count: 1 },
    { path: "memory/dreaming", accesses: ["searched"], count: 1 },
  ])
})

test("memory: a different root is honoured and malformed input is skipped", () => {
  const opened = deriveOpenedMemory(blocks(
    { type: "tool_use", content: "", toolName: "Read", toolInput: "{not json" },
    call("Read", { file_path: "C:/repo/notes/todo.md" }),
    call("Read", { file_path: "C:/repo/memory/todo.md" }),
  ), "notes")
  assert.deepEqual(opened, [{ path: "notes/todo.md", accesses: ["read"], count: 1 }])
})

test("memory: startup notes are taken out of the opened list so nothing shows twice", () => {
  const opened = deriveOpenedMemory(blocks(
    call("Read", { file_path: "L:/Workspaces/Nova/memory/Index.md" }),
    call("Read", { file_path: "L:/Workspaces/Nova/memory/catalogue.md" }),
  ))
  assert.deepEqual(withoutPaths(opened, ["memory/index.md", "memory/dreaming/mood.md"]).map(file => file.path), ["memory/catalogue.md"])
  assert.deepEqual(withoutPaths([], ["memory/index.md"]), [])
})
