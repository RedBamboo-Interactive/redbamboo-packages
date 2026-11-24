import type { MessageBlock, PromptCacheCounts } from "../types"
import { getEffectiveToolName } from "./tool-semantics.ts"

const cachePercent = new Intl.NumberFormat(undefined, { style: "percent", maximumFractionDigits: 1 })

export function formatPromptCacheCounts(counts?: PromptCacheCounts | null): string | null {
  if (!counts) return null
  const { cachedInputTokens: cached, inputTokens: input } = counts
  if (!Number.isSafeInteger(cached) || !Number.isSafeInteger(input) || cached < 0 || input <= 0 || cached > input)
    return null

  const ratio = cached / input
  const rate = ratio > 0 && ratio < 0.001 ? `<${cachePercent.format(0.001)}`
    : ratio > 0.999 && cached < input ? `>${cachePercent.format(0.999)}`
    : cachePercent.format(ratio)
  return `${rate} · ${cached.toLocaleString()} / ${input.toLocaleString()} tokens`
}

/**
 * What a conversation has used so far, read from the tool calls of the messages the client has loaded.
 * Nothing here is tracked server-side: a partial history gives partial counts, and the Info modal says so.
 */

export interface UsedSkill {
  /** The skill as the conversation named it: a `Skill` call's `skill`, or the folder in `skills/<name>/SKILL.md`. */
  name: string
  count: number
}

export type MemoryAccess = "read" | "edited" | "searched"

export interface OpenedMemoryFile {
  /** Path from the memory root down, forward slashes (for example `memory/index.md`). */
  path: string
  accesses: MemoryAccess[]
  count: number
}

const SKILL_FILE = /skills[\\/]+([\w.-]+)[\\/]+SKILL\.md/i
const FILE_READ_TOOLS = new Set(["read"])
const FILE_EDIT_TOOLS = new Set(["edit", "write", "multiedit", "notebookedit"])
const SEARCH_TOOLS = new Set(["grep", "glob"])

function parseInput(toolInput?: string): Record<string, unknown> | null {
  if (!toolInput) return null
  try {
    const parsed: unknown = JSON.parse(toolInput)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** The key two spellings of one skill share: `Chat Stability` and `chat-stability`. */
export function skillKey(name: string): string {
  return name.trim().toLowerCase().replace(/[\s_]+/g, "-")
}

/** Skills the conversation used, most used first, then in the order first used. */
export function deriveUsedSkills(messages: readonly MessageBlock[]): UsedSkill[] {
  const counts = new Map<string, UsedSkill>()
  const add = (name: string) => {
    const key = skillKey(name)
    if (!key) return
    const existing = counts.get(key)
    if (existing) existing.count++
    else counts.set(key, { name, count: 1 })
  }

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool_use") continue
      const input = parseInput(part.toolInput)
      if (part.toolName?.toLowerCase() === "skill" && typeof input?.skill === "string") {
        add(input.skill)
        continue
      }
      // Codex (and a Claude Read) opens the skill's file instead of calling a Skill tool. Only a call
      // that reads counts: a search or a write that mentions the path is not using the skill.
      const effective = (getEffectiveToolName(part.toolName, part.toolInput) ?? "").toLowerCase()
      if (!FILE_READ_TOOLS.has(effective)) continue
      const opened = part.toolInput?.match(SKILL_FILE)
      if (opened?.[1]) add(opened[1])
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count)
}

/** `memory/...` from a path or a shell command, forward slashes; null when nothing is under the root. */
function memoryPathIn(text: string, root: string): string | null {
  const normalized = text.replace(/\\/g, "/")
  const escaped = root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  const match = normalized.match(new RegExp(`(?:^|[\\s"'=/])(${escaped}[^\\s"'|;<>*?]*)`, "i"))
  return match?.[1] ? match[1].replace(/\/+$/, "") || null : null
}

/**
 * Notes under `root` the conversation read, edited or searched, in the order they were first opened.
 * Only first-class file tools and shell commands that read or search count; a command that writes in
 * its own words (redirects, Set-Content) is left out rather than guessed at.
 */
export function deriveOpenedMemory(messages: readonly MessageBlock[], root = "memory/"): OpenedMemoryFile[] {
  const rootWithSlash = root.endsWith("/") ? root : `${root}/`
  const files = new Map<string, OpenedMemoryFile>()
  const add = (path: string, access: MemoryAccess) => {
    const key = path.toLowerCase()
    const existing = files.get(key)
    if (existing) {
      existing.count++
      if (!existing.accesses.includes(access)) existing.accesses.push(access)
    } else {
      files.set(key, { path, accesses: [access], count: 1 })
    }
  }

  for (const message of messages) {
    for (const part of message.parts) {
      if (part.type !== "tool_use" || !part.toolName) continue
      const name = (getEffectiveToolName(part.toolName, part.toolInput) ?? part.toolName).toLowerCase()
      const input = parseInput(part.toolInput)
      if (!input) continue

      const access: MemoryAccess | null = FILE_EDIT_TOOLS.has(name) ? "edited"
        : FILE_READ_TOOLS.has(name) ? "read"
        : SEARCH_TOOLS.has(name) ? "searched"
        : null
      if (!access) continue
      // A first-class tool names its path; Codex reads and searches through a shell command, which
      // getEffectiveToolName already recognised as a read or search (never a write).
      for (const field of [input.file_path, input.notebook_path, input.path, input.pattern, input.command]) {
        const path = typeof field === "string" ? memoryPathIn(field, rootWithSlash) : null
        if (path) { add(path, access); break }
      }
    }
  }
  return [...files.values()]
}

/** The opened notes that are not among `paths` (compared without case): what is shown once, not twice. */
export function withoutPaths(opened: readonly OpenedMemoryFile[], paths: readonly string[]): OpenedMemoryFile[] {
  const skip = new Set(paths.map(path => path.toLowerCase()))
  return opened.filter(file => !skip.has(file.path.toLowerCase()))
}
