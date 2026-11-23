/**
 * A model id as a person says it: `claude-opus-5-5` is "Opus 5.5". Drops a vendor prefix and a date
 * suffix, title-cases the family and dots a dashed version. An id that is not of that shape passes
 * through unchanged.
 */
const FAMILY_ID = /^(?:claude-)?(opus|sonnet|haiku|fable)-(\d{1,2}(?:-\d{1,2})*)(?:-\d{8})?$/i

export function formatModelName(model: string | null | undefined): string {
  if (!model) return ""
  const match = model.trim().match(FAMILY_ID)
  if (!match) return model
  const family = match[1]!
  return `${family[0]!.toUpperCase()}${family.slice(1).toLowerCase()} ${match[2]!.replaceAll("-", ".")}`
}
