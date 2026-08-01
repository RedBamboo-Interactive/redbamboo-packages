import type { CSSProperties } from "react"

/**
 * Deliberately inline: every Leaf plugin ships a global Tailwind stylesheet,
 * so a later rounded-* shorthand can otherwise reset a directional corner.
 */
export const USER_BUBBLE_SHAPE_STYLE = {
  borderRadius: "calc(var(--radius) * 1.4)",
  borderBottomRightRadius: "calc(var(--radius) * 0.6)",
} satisfies CSSProperties
