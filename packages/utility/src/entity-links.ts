/** Build the canonical RedLeaf route for a concrete entity. */
export function getEntityHref(typeSlug: string, entityId: string): string {
  return `/database/entities/${encodeURIComponent(typeSlug)}/${encodeURIComponent(entityId)}`
}
