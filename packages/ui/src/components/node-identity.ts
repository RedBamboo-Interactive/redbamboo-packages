// A node's look: an icon from a curated Phosphor set and a colour from a small fixed palette.
//
// The kernel's node entity stores both (`icon`: a name from NODE_ICONS, `color`: a token from
// NODE_COLORS) and RedCompute's GET /nodes carries them. Kind alone cannot tell two desktops apart, so
// a node is recognized by the two together. A node without them (an older kernel, a value outside the
// lists) shows its platform's logo in a neutral colour.

/** One icon a node may have: the Phosphor name (rendered `ph-bold ph-<name>`) and what it stands for. */
export interface NodeIconChoice {
  name: string
  label: string
}

/** The icons a node may have. The kernel accepts exactly these names. */
export const NODE_ICONS: readonly NodeIconChoice[] = [
  { name: "desktop-tower", label: "Tower" },
  { name: "desktop", label: "Desktop" },
  { name: "laptop", label: "Laptop" },
  { name: "device-tablet", label: "Tablet" },
  { name: "hard-drives", label: "Server" },
  { name: "hard-drive", label: "Storage (NAS)" },
  { name: "cpu", label: "Mini PC" },
  { name: "graphics-card", label: "GPU box" },
  { name: "game-controller", label: "Gaming PC" },
  { name: "cube", label: "Virtual machine" },
  { name: "cloud", label: "Cloud" },
  { name: "house", label: "Home" },
]

/** One colour a node may have: the token the kernel stores and the colour drawn. */
export interface NodeColorChoice {
  token: string
  label: string
  /** One value for both themes: at least 3:1 against white, the muted surface and near-black. */
  hex: string
}

/**
 * The node palette, in the order the kernel hands out defaults (the first one no other node of the
 * same owner uses). Red comes last: it reads as an error next to a status.
 */
export const NODE_COLORS: readonly NodeColorChoice[] = [
  { token: "blue", label: "Blue", hex: "#3b82f6" },
  { token: "teal", label: "Teal", hex: "#0d9488" },
  { token: "violet", label: "Violet", hex: "#8b5cf6" },
  { token: "amber", label: "Amber", hex: "#c47a06" },
  { token: "pink", label: "Pink", hex: "#ec4899" },
  { token: "green", label: "Green", hex: "#1f9d4c" },
  { token: "orange", label: "Orange", hex: "#ea580c" },
  { token: "red", label: "Red", hex: "#e5383b" },
]

/** The icon of "Automatic" in a node choice: the server picks the way. */
export const NODE_AUTOMATIC_ICON = "signpost"

/** What a node says about itself that its look is drawn from (GET /compute/nodes or the kernel's /api/nodes). */
export interface NodeLook {
  icon?: string | null
  color?: string | null
  /** windows | linux | macos | … (Compute's `os`, the kernel's `platform.os`). */
  os?: string | null
}

/** What to draw: a Phosphor icon name and a colour, null for the neutral (muted) one. */
export interface NodeIdentity {
  icon: string
  /** The palette entry, or null when the node has none (draw it muted). */
  color: NodeColorChoice | null
  /** True when the icon is the platform fallback, not one the node has. */
  fallback: boolean
}

/** The fallback icon for a platform: its logo, a tower when the platform is unknown. */
export function platformNodeIcon(os?: string | null): string {
  switch ((os ?? "").toLowerCase()) {
    case "windows": return "windows-logo"
    case "linux": return "linux-logo"
    case "macos":
    case "osx":
    case "darwin": return "apple-logo"
    default: return "desktop-tower"
  }
}

export function isNodeIcon(name: unknown): name is string {
  return typeof name === "string" && NODE_ICONS.some(i => i.name === name)
}

export function nodeColor(token: unknown): NodeColorChoice | null {
  return typeof token === "string" ? NODE_COLORS.find(c => c.token === token) ?? null : null
}

/** The icon and colour to draw for a node; values outside the lists fall back like absent ones. */
export function nodeIdentity(look: NodeLook): NodeIdentity {
  const has = isNodeIcon(look.icon)
  return { icon: has ? look.icon! : platformNodeIcon(look.os), color: nodeColor(look.color), fallback: !has }
}

/** The `<i>` classes for a Phosphor icon name. */
export function nodeIconClass(icon: string): string {
  return `ph-bold ph-${icon}`
}
