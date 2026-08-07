import {
  getEntityHref,
  parseEntityEmbedHref,
  parseEntityHref,
} from "@redbamboo/utility/entity-links"
import type {
  EntityCardEntity,
  EntityCardPresentation,
  EntityCardVisual,
} from "@redbamboo/ui"

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

export interface EntityEmbedCardView {
  entity: EntityCardEntity
  subtitle: string
  visual: EntityCardVisual
}

/** Merge an authorized host projection over the identity-only Markdown fallback. */
export function resolveEntityEmbedCardView(
  reference: EntityEmbedReference,
  presentation: EntityCardPresentation | null,
): EntityEmbedCardView {
  const fallbackEntity: EntityCardEntity = {
    id: reference.id,
    typeSlug: reference.typeSlug,
    name: reference.name,
  }
  const matchesReference = presentation?.entity.id === reference.id
    && presentation.entity.typeSlug === reference.typeSlug
  const resolved = matchesReference ? presentation : null
  return {
    entity: resolved?.entity ?? fallbackEntity,
    subtitle: resolved?.subtitle ?? humanize(reference.typeSlug),
    visual: resolved?.visual ?? {
      icon: "ph-bold ph-cube",
      color: "var(--color-accent-teal)",
    },
  }
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

function humanize(slug: string): string {
  return slug
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}
