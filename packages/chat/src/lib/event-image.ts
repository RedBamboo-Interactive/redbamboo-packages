/**
 * Image attachments on event payloads.
 *
 * Driven by the payload, not by the event type: any plugin that hangs an image
 * asset off its event metadata gets it rendered in the event modal for free.
 * Keys are accepted in both casings because payloads come from plugins that
 * don't agree on one.
 */

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg)(?:[?#]|$)/i

/** Payload keys carrying a ready-made URL. */
const URL_KEYS = ["asset_url", "assetUrl", "image_url", "imageUrl"]
/** Payload keys carrying an id that resolves to `/api/assets/{id}`. */
const ID_KEYS = ["asset_id", "assetId", "image_id", "imageId"]
/** Payload keys a plugin uses to report it couldn't capture the image. */
const ERROR_KEYS = ["frame_error", "frameError", "image_error", "imageError"]
const MEDIA_TYPE_KEYS = ["media_type", "mediaType", "content_type", "contentType"]

export interface EventImage {
  /** Resolved src; absent when the payload only reported a failure. */
  src?: string
  /** Plugin-reported reason the image is missing, shown in its place. */
  error?: string
}

function str(data: Record<string, unknown>, key: string): string | undefined {
  const v = data[key]
  return typeof v === "string" && v ? v : undefined
}

function firstStr(data: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const v = str(data, key)
    if (v) return v
  }
  return undefined
}

/** The image an event payload carries, or null when it carries none. */
export function eventImage(
  data: Record<string, unknown> | null | undefined,
  resolveImageSrc?: (src: string) => string | undefined,
): EventImage | null {
  if (!data) return null

  // A reported failure wins over any asset reference the payload still
  // carries — the asset is the one that failed.
  const error = firstStr(data, ERROR_KEYS)
  if (error) return { error }

  // A declared image media type stands in for an extension, since asset ids
  // don't always carry one.
  const declared = firstStr(data, MEDIA_TYPE_KEYS)?.startsWith("image/") ?? false
  const isImage = (v: string) => declared || IMAGE_EXT.test(v) || v.startsWith("data:image/")

  const url = URL_KEYS.map(k => str(data, k)).find(v => v && isImage(v))
  const id = url ? undefined : ID_KEYS.map(k => str(data, k)).find(v => v && isImage(v))
  const raw = url ?? (id ? `/api/assets/${id}` : undefined)
  if (!raw) return null

  return { src: resolveImageSrc?.(raw) ?? raw }
}
