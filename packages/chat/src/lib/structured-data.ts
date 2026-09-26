export type StructuredJson = null | boolean | number | string | StructuredJson[] | { [key: string]: StructuredJson }

const ACRONYMS: Record<string, string> = {
  api: "API",
  gm: "GM",
  id: "ID",
  npc: "NPC",
  uid: "UID",
  url: "URL",
}

export function humanizeJsonKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1 $2")
    .trim()

  if (!spaced) return "Value"

  return spaced
    .split(/\s+/)
    .map((word, index) => {
      const acronym = ACRONYMS[word.toLowerCase()]
      if (acronym) return acronym
      const lower = word.toLowerCase()
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower
    })
    .join(" ")
}

export function isTechnicalJsonKey(key: string): boolean {
  const compact = key.replace(/[_-]/g, "")
  return /^(?:id|uid|revision|createdat|updatedat|timestamp)$/i.test(compact)
    || /(?:id|uid|timestamp)$/i.test(compact)
}

export function isImageJsonField(key: string, value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false
  const normalized = key.replace(/[_-]/g, "").toLowerCase()
  if (!/(?:image|avatar|portrait|cover)(?:url|src|path)$/.test(normalized)) return false
  return /^(?:data:image\/|https?:\/\/|\/)/i.test(value)
    || /\.(?:png|jpe?g|gif|webp|svg|bmp|ico)(?:[?#].*)?$/i.test(value)
}

export function parseStructuredJson(content: string): StructuredJson | undefined {
  try {
    const value = JSON.parse(content) as unknown
    return isStructuredJson(value) ? value : undefined
  } catch {
    return undefined
  }
}

function isStructuredJson(value: unknown): value is StructuredJson {
  if (value == null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return true
  if (Array.isArray(value)) return value.every(isStructuredJson)
  if (typeof value !== "object") return false
  return Object.values(value).every(isStructuredJson)
}
