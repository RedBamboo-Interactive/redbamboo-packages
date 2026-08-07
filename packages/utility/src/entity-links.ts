/** Build the canonical RedLeaf route for a concrete entity. */
export function getEntityHref(typeSlug: string, entityId: string): string {
  return `/database/entities/${encodeURIComponent(typeSlug)}/${encodeURIComponent(entityId)}`
}

export interface EntityHrefParts {
  typeSlug: string
  entityId: string
}

export type EntityEmbedDisplay = "card" | "preview" | "inline" | "field"

export interface EntityEmbedHrefParts extends EntityHrefParts {
  display: EntityEmbedDisplay
  field?: string
}

export interface EntityEmbedHrefOptions {
  display?: Exclude<EntityEmbedDisplay, "field">
  field?: string
}

/** Build RedLeaf's portable Markdown entity-embed target. */
export function getEntityEmbedHref(
  typeSlug: string,
  entityId: string,
  options: EntityEmbedHrefOptions = {},
): string {
  const params = new URLSearchParams()
  if (options.field) params.set("field", options.field)
  else if (options.display && options.display !== "card") params.set("display", options.display)

  const query = params.toString()
  const href = `redleaf://${encodeURIComponent(typeSlug)}/${encodeURIComponent(entityId)}`
  return query ? `${href}?${query}` : href
}

/** Parse the established redleaf:// entity-embed target used by Page Markdown. */
export function parseEntityEmbedHref(href: string): EntityEmbedHrefParts | null {
  const match = href.trim().match(/^redleaf:\/\/([^/?#]+)\/([^?#]+)(?:\?([^#]*))?$/i)
  if (!match) return null

  let typeSlug: string
  let entityId: string
  try {
    typeSlug = decodeURIComponent(match[1])
    entityId = decodeURIComponent(match[2])
  } catch {
    return null
  }
  if (!typeSlug || !entityId) return null

  const params = new URLSearchParams(match[3] ?? "")
  const field = params.get("field")?.trim()
  if (field) return { typeSlug, entityId, display: "field", field }

  const requestedDisplay = params.get("display")
  const display = requestedDisplay === "preview" || requestedDisplay === "inline"
    ? requestedDisplay
    : "card"
  return { typeSlug, entityId, display }
}

/**
 * Parse a canonical RedLeaf entity route. Relative routes are portable across
 * local and tunneled RedLeaf hosts. Absolute routes are accepted only when
 * they match the caller-provided origin.
 */
export function parseEntityHref(href: string, currentOrigin?: string): EntityHrefParts | null {
  const candidate = href.trim()
  if (!candidate) return null

  const relative = candidate.startsWith("/") && !candidate.startsWith("//")
  let url: URL
  try {
    if (relative) {
      url = new URL(candidate, "http://redleaf.local")
    } else {
      if (!currentOrigin) return null
      const origin = new URL(currentOrigin).origin
      url = new URL(candidate, origin)
      if (url.origin !== origin) return null
    }
  } catch {
    return null
  }

  if (url.search || url.hash) return null
  const segments = url.pathname.split("/")
  if (segments.length !== 5
    || segments[0] !== ""
    || segments[1] !== "database"
    || segments[2] !== "entities") return null

  try {
    const typeSlug = decodeURIComponent(segments[3])
    const entityId = decodeURIComponent(segments[4])
    return typeSlug && entityId ? { typeSlug, entityId } : null
  } catch {
    return null
  }
}
