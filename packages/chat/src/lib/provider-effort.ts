export function formatProviderEffort(effort?: string | null): string | null {
  const value = effort?.trim()
  if (!value) return null

  if (value.toLowerCase() === "xhigh") return "XHigh"

  return value.charAt(0).toUpperCase() + value.slice(1)
}
