/**
 * The five shared accent meanings used by app identity and ambient chat.
 * Source-backed apps and event types use matching RedLeaf color entities;
 * these constants cover code-only surfaces such as suite discovery fallbacks.
 */
export const DOMAIN_COLORS = {
  foundation: "#4A9D5B",
  technology: "#5B8BC4",
  life: "#C9944A",
  imagination: "#7C4DFF",
  presence: "#C74B7A",
} as const

export type DomainColor = keyof typeof DOMAIN_COLORS
