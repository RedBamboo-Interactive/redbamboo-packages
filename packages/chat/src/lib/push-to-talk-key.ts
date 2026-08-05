export const DEFAULT_PUSH_TO_TALK_KEY = "F13"

const namedKeys = new Set([
  "Backspace", "Tab", "Enter", "Pause", "CapsLock", "PageUp", "PageDown",
  "End", "Home", "ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown",
  "PrintScreen", "Insert", "Delete", "ScrollLock",
])

export function normalizePushToTalkKey(value: string): string | null {
  const key = value.trim()
  const functionKey = /^f([1-9]|1[0-9]|2[0-4])$/i.exec(key)
  if (functionKey) return `F${functionKey[1]}`
  if (/^[a-z]$/i.test(key)) return key.toLowerCase()
  if (/^[0-9]$/.test(key)) return key
  return namedKeys.has(key) ? key : null
}
