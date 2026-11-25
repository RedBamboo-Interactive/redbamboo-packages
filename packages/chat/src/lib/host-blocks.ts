import type { HastLike } from "./chat-actions"

/** A `pre` or `code` node as react-markdown hands it over: hast with its element properties. */
export interface HastElementLike extends HastLike {
  properties?: { className?: unknown }
  children?: readonly HastElementLike[]
}

const LANGUAGE_PREFIX = "language-"

/**
 * The info-string language of a fenced block (```lang), from its `pre` node, or null.
 * rehype-highlight may add `hljs` beside the `language-*` class; only the language counts.
 */
export function fencedBlockLanguage(pre: HastElementLike | undefined): string | null {
  const code = pre?.children?.find(child => child.type === "element" && child.tagName === "code")
  const className = code?.properties?.className
  const classes = Array.isArray(className) ? className : typeof className === "string" ? className.split(/\s+/) : []
  for (const name of classes) {
    if (typeof name === "string" && name.startsWith(LANGUAGE_PREFIX) && name.length > LANGUAGE_PREFIX.length)
      return name.slice(LANGUAGE_PREFIX.length).toLowerCase()
  }
  return null
}
