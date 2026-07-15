/**
 * Single source of truth for the Red Suite roster.
 *
 * Ports, icons, colors, and descriptions were previously hardcoded independently in
 * app-switcher, chat's context-card, and ask-nova — and had already drifted. Anything
 * that needs the suite topology should import from here.
 *
 * Colors follow the visible app-switcher branding. Each app's /discover manifest also
 * carries iconClass/iconColor; live manifest values take precedence when available.
 */

export interface SuiteApp {
  port: number
  /** Service name as reported by the app's /discover manifest. */
  name: string
  /** Brand name split for two-tone rendering, e.g. ["Red", "Compute"]. */
  nameParts: [string, string]
  /** Font Awesome icon class. */
  icon: string
  /** Brand accent color (hex). */
  color: string
  description: string
}

export const SUITE_APPS: readonly SuiteApp[] = [
  { port: 18800, name: "RedCompute", nameParts: ["Red", "Compute"], icon: "ph-bold ph-cpu", color: "#26A69A", description: "AI compute service" },
  { port: 18801, name: "CodeRed", nameParts: ["Code", "Red"], icon: "ph-bold ph-terminal", color: "#E55B5B", description: "Development tools" },
  { port: 18802, name: "RedMatter", nameParts: ["Red", "Matter"], icon: "ph-bold ph-fire", color: "#D4A03C", description: "Game engine CMS" },
  { port: 18803, name: "Nova", nameParts: ["No", "va"], icon: "ph-bold ph-star", color: "#C74B7A", description: "AI assistant" },
  { port: 18804, name: "RedLeaf", nameParts: ["Red", "Leaf"], icon: "ph-bold ph-leaf", color: "#66BB6A", description: "Content & knowledge" },
] as const

export const SUITE_PORTS: readonly number[] = SUITE_APPS.map((a) => a.port)

export const NOVA_PORT = 18803

export function getSuiteApp(port: number | string): SuiteApp | undefined {
  const p = typeof port === "string" ? Number(port) : port
  return SUITE_APPS.find((a) => a.port === p)
}

/** The suite app the current page is served from, if any. */
export function currentSuiteApp(): SuiteApp | undefined {
  if (typeof window === "undefined") return undefined
  return getSuiteApp(window.location.port)
}
