import { isLoopbackHost } from "./media-url.ts"

/** Keep authored links to this Leaf server on the current desktop or tunnel origin. */
export function canonicalizeLeafLinkHref(href: string | undefined): string | undefined {
  if (!href || !/^https?:\/\//i.test(href)) return href
  try {
    const url = new URL(href)
    if (!isLoopbackHost(url.hostname) || url.port !== "18804" || url.username || url.password || url.pathname.startsWith("//")) return href
    return `${url.pathname}${url.search}${url.hash}`
  } catch {
    return href
  }
}

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
