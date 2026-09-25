/**
 * Return the UI-level tool name for a provider tool call.
 *
 * Codex exposes filesystem reads and searches as shell commands on Windows,
 * while Claude emits first-class Read/Grep/Glob tools. Keep the transport
 * payload intact for the shell renderer, but recover the semantic operation so
 * colour, labels, and streaming status stay provider-independent.
 */
export function getEffectiveToolName(toolName?: string, toolInput?: string): string | undefined {
  if (!toolName) return undefined
  const lowerName = toolName.toLowerCase()
  if (lowerName !== "bash" && lowerName !== "powershell") return toolName

  const command = parseCommand(toolInput)
  if (!command || looksMutating(command)) return toolName

  if (/\b(?:rg|ripgrep)\b(?!\s+--files\b)|\bSelect-String\b|\bfindstr(?:\.exe)?\b/i.test(command)) {
    return "Grep"
  }
  if (/\b(?:rg|ripgrep)\s+--files\b|\bGet-ChildItem\b|(?:^|[;&|]\s*)(?:ls|dir)\b/i.test(command)) {
    return "Glob"
  }
  if (/\bGet-Content\b|(?:^|[;&|]\s*)(?:cat|type)\b/i.test(command)) {
    return "Read"
  }

  return toolName
}

export type ToolActivityCategory = "agent" | "read-only" | "mutating" | "shell"

const readOnlyTools = new Set([
  "read", "glob", "grep", "agent", "websearch", "webfetch",
  "toolsearch", "cronlist", "todoread", "monitor",
  "exitplanmode", "enterplanmode", "askuserquestion",
  "list", "codesearch", "explore",
])

const mutatingTools = new Set([
  "edit", "write", "notebookedit", "todowrite",
  "croncreate", "crondelete", "pushnotification",
])

/** Provider-neutral semantic colour category without replacing the visible tool name. */
export function getToolActivityCategory(toolName?: string, toolInput?: string): ToolActivityCategory | null {
  const effective = getEffectiveToolName(toolName, toolInput)
  if (!effective) return null
  const name = effective.toLowerCase()
  if (name.startsWith("agent:")) return "agent"
  if (readOnlyTools.has(name) || /(?:^|_)(?:read|search|list)$/.test(name)) return "read-only"
  if (mutatingTools.has(name) || /(?:^|_)(?:create|update|edit|delete|post|generate|upsert)$/.test(name)) return "mutating"
  if (name === "bash" || name === "powershell") return "shell"
  return null
}

function parseCommand(toolInput?: string): string | undefined {
  if (!toolInput) return undefined
  try {
    const parsed = JSON.parse(toolInput) as { command?: unknown }
    return typeof parsed.command === "string" ? parsed.command : undefined
  } catch {
    return undefined
  }
}

// Never paint a mixed read/write shell command teal. This is deliberately
// conservative: an unrecognised safe command remains a shell command.
function looksMutating(command: string): boolean {
  return /\b(?:Set-Content|Add-Content|Out-File|Remove-Item|Move-Item|Copy-Item|New-Item|Rename-Item|Clear-Content|git\s+(?:add|commit|push|reset|checkout|restore|clean)|npm\s+(?:install|publish)|pnpm\s+(?:install|publish))\b/i.test(command)
    || /(?:^|\s)(?:\d?>>?|&>)\s*[^=&]/.test(command)
}
