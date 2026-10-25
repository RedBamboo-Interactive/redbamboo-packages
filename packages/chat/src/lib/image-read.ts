import type { MessagePart } from "../types"

export const IMAGE_FILE_EXTENSION = /\.(?:avif|bmp|gif|ico|jpe?g|png|svg|webp)(?:[?#].*)?$/i

/** The source image intentionally inspected by a read-only image tool call. */
export function imageReadPath(part: MessagePart): string | undefined {
  if (part.type !== "tool_use" || !part.toolName || !part.toolInput) return undefined

  let input: Record<string, unknown>
  try {
    const parsed = JSON.parse(part.toolInput) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    input = parsed as Record<string, unknown>
  } catch {
    return undefined
  }

  const path = [input.path, input.file_path, input.image_path]
    .find((value): value is string => typeof value === "string" && value.length > 0)
  if (!path) return undefined

  const name = part.toolName.toLowerCase()
  if (name === "viewimage" || name.endsWith("view_image") || name.endsWith("view-image")) return path
  if (name === "read" && IMAGE_FILE_EXTENSION.test(path)) return path
  return undefined
}
