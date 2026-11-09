import type { AccessLevel, SessionConfigOption } from "../types"

/** Lowest first: the cap and "raising" compare by this order. */
export const ACCESS_LEVELS: readonly AccessLevel[] = ["plan", "ask", "auto", "full"]

export const ACCESS_LEVEL_LABELS: Record<AccessLevel, string> = {
  plan: "Plan",
  ask: "Ask",
  auto: "Auto",
  full: "Full",
}

/** The one line under the Permissions row, for the level it shows. */
export const ACCESS_LEVEL_DESCRIPTIONS: Record<AccessLevel, string> = {
  plan: "Reads and plans, changes nothing.",
  ask: "Edits files in the project, asks before anything else.",
  auto: "A safety check approves routine actions and blocks risky ones.",
  full: "Runs everything without asking.",
}

const ACCESS_LEVEL_ICONS: Record<AccessLevel, string> = {
  plan: "ph-bold ph-notepad",
  ask: "ph-bold ph-hand",
  auto: "ph-bold ph-shield-check",
  full: "ph-bold ph-shield-warning",
}

// Same hues as the rest of the modal's option rows; Full is the amber the Info button turns.
const ACCESS_LEVEL_COLORS: Record<AccessLevel, string> = {
  plan: "#38bdf8",
  ask: "#2dd4bf",
  auto: "#a78bfa",
  full: "#fbbf24",
}

export function isAccessLevel(value: unknown): value is AccessLevel {
  return typeof value === "string" && (ACCESS_LEVELS as readonly string[]).includes(value)
}

export function accessLevelRank(level: AccessLevel): number {
  return ACCESS_LEVELS.indexOf(level)
}

export interface AccessLevelChoice {
  level: AccessLevel
  option: SessionConfigOption
  /** Why it can't be chosen; null when it can. */
  disabledReason: "full_access_not_enabled" | "above_session_cap" | null
}

/**
 * The levels the Permissions row offers: only the provider's supported levels,
 * in canonical order, with Full disabled while it is not enabled for the
 * install and anything above the session's cap disabled. Unknown values are
 * dropped rather than shown as a level nobody can explain.
 */
export function accessLevelChoices(options: {
  supported: readonly unknown[] | null | undefined
  max?: AccessLevel | null
  fullAccessEnabled?: boolean
}): AccessLevelChoice[] {
  const supported = new Set((options.supported ?? []).filter(isAccessLevel))
  const cap = isAccessLevel(options.max) ? accessLevelRank(options.max) : Infinity
  return ACCESS_LEVELS.filter(level => supported.has(level)).map(level => ({
    level,
    option: {
      value: level,
      label: ACCESS_LEVEL_LABELS[level],
      icon: ACCESS_LEVEL_ICONS[level],
      color: ACCESS_LEVEL_COLORS[level],
    },
    disabledReason: accessLevelRank(level) > cap
      ? "above_session_cap"
      : level === "full" && options.fullAccessEnabled === false
        ? "full_access_not_enabled"
        : null,
  }))
}
