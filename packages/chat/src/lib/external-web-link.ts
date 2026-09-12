export function isExternalWebLink(href?: string): boolean {
  return /^https?:\/\//i.test(href ?? "")
}

export function isInternalLeafLink(href: string | undefined, currentOrigin: string): boolean {
  if (!href) return false
  if (href.startsWith("/") && !href.startsWith("//")) return true
  if (!isExternalWebLink(href) || !currentOrigin) return false

  try {
    return new URL(href).origin === new URL(currentOrigin).origin
  } catch {
    return false
  }
}
