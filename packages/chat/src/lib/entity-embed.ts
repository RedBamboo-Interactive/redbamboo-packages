import {
  getEntityHref,
  parseEntityEmbedHref,
  parseEntityHref,
} from "@redbamboo/utility/entity-links"

interface MarkdownNode {
  type?: string
  tagName?: string
  value?: string
  properties?: Record<string, unknown>
  children?: MarkdownNode[]
}

export interface EntityEmbedReference {
  id: string
  typeSlug: string
  name: string
  href: string
}

/** Upgrade only a standalone entity card reference. Inline links stay links. */
export function parseEntityEmbedParagraph(
  node: unknown,
  currentOrigin?: string,
): EntityEmbedReference | null {
  const paragraph = asNode(node)
  if (!paragraph || paragraph.tagName !== "p") return null

  const meaningful = (paragraph.children ?? []).filter((child) =>
    child.type !== "text" || !!child.value?.trim())
  if (meaningful.length !== 1) return null

  const link = meaningful[0]
  if (link.type !== "element" || link.tagName !== "a") return null
  const href = typeof link.properties?.href === "string" ? link.properties.href : null
  if (!href) return null

  const embedded = parseEntityEmbedHref(href)
  const entity = embedded?.display === "card"
    ? embedded
    : embedded
      ? null
      : parseEntityHref(href, currentOrigin)
  const name = textContent(link).trim()
  if (!entity || !name) return null

  return {
    id: entity.entityId,
    typeSlug: entity.typeSlug,
    name,
    href: getEntityHref(entity.typeSlug, entity.entityId),
  }
}

function asNode(value: unknown): MarkdownNode | null {
  return typeof value === "object" && value !== null ? value as MarkdownNode : null
}

function textContent(node: MarkdownNode): string {
  if (node.type === "text") return node.value ?? ""
  return (node.children ?? []).map(textContent).join("")
}
