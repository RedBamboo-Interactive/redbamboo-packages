export function isExternalWebLink(href?: string): boolean {
  return /^https?:\/\//i.test(href ?? "")
}
