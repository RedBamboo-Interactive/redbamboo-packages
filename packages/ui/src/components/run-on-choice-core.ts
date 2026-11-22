// The rules behind RunOnChoice, kept free of React so they can be tested on their own.
//
// The data is RedCompute's GET /nodes (through the kernel: GET /compute/nodes): node zero first,
// then every remote node the signed-in person may see, each with placement {eligible, reason}.

/** The members of a GET /compute/nodes item that RunOnChoice reads. */
export interface RunOnNode {
  id: string
  name: string
  isLocal: boolean
  /** online | offline | revoked | needs-update | pending-confirmation */
  status: string
  /** "This is my node" was confirmed; always true for node zero. */
  confirmed?: boolean
  /** Whether work may be placed on the node, and the reason code when it may not. */
  placement?: { eligible: boolean; reason?: string | null }
  /** What the node runs (node zero: every configured capability). */
  capabilities?: ReadonlyArray<{ slug: string }>
  /** Its look (see node-identity): absent from an older kernel or RedCompute. */
  icon?: string | null
  color?: string | null
  /** windows | linux | macos: the fallback icon when it has none. */
  os?: string | null
}

/** The capability the work needs, to grey out nodes that do not have it. */
export interface RunOnCapability {
  slug: string
  /** Its display name, for "No <name> here"; the slug when absent. */
  name?: string
}

/** One node as the control shows it. */
export interface RunOnOption {
  id: string
  name: string
  isLocal: boolean
  /** Whether the person may pick it. */
  selectable: boolean
  /** Why it cannot be picked, in words; null when it can. */
  reason: string | null
  /** online | offline | … as the node list says; null for a choice the list no longer has. */
  status: string | null
  icon?: string | null
  color?: string | null
  os?: string | null
}

/** What the control shows once the node list is read (while it loads, or when it cannot be read, it shows a muted row). */
export type RunOnView =
  /** No node can run the work right now. */
  | { mode: "none"; message: string }
  /** One node can run it: a read-only row, never a dropdown. */
  | { mode: "single"; node: RunOnOption }
  /** Two or more can: "Automatic" first, then the nodes, the ones that cannot run it disabled with why. */
  | { mode: "picker"; automaticLabel: string; options: RunOnOption[] }

/** The default node list: the kernel's proxy to RedCompute, read as the signed-in person. */
export const RUN_ON_NODES_PATH = "/compute/nodes"

/** The Select value that stands for "Automatic" (node ids are `node_<ulid>` or `local`). */
export const RUN_ON_AUTOMATIC = "automatic"

/** The tooltip on the read-only row. */
export const RUN_ON_SINGLE_HINT = "Work runs on this computer."

const STATUS_WORDS: Record<string, string> = {
  online: "Online",
  offline: "Offline",
  "needs-update": "Needs an update",
  revoked: "Revoked",
  "pending-confirmation": "Not confirmed yet",
}

/** A node status in words ("Online"); unknown statuses are humanized, null stays null. */
export function runOnStatusWords(status: string | null | undefined): string | null {
  if (!status) return null
  return STATUS_WORDS[status] ?? words(status)
}

const REASON_WORDS: Record<string, string> = {
  revoked: "Revoked",
  not_confirmed: "Not confirmed by its owner yet",
  needs_update: "Needs an update",
  offline: "Offline",
  remote_execution_not_available: "Cannot run work yet",
}

function words(code: string): string {
  const known = REASON_WORDS[code]
  if (known) return known
  const text = code.replace(/[_-]+/g, " ").trim()
  return text ? text[0]!.toUpperCase() + text.slice(1) : "Unavailable"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The nodes in a GET /compute/nodes answer ({nodes: [...]}, or a bare array); malformed items are dropped. */
export function parseRunOnNodes(body: unknown): RunOnNode[] {
  const items = Array.isArray(body) ? body : isRecord(body) && Array.isArray(body.nodes) ? body.nodes : null
  if (!items) throw new Error("The node list is not in the expected shape")
  const nodes: RunOnNode[] = []
  for (const item of items) {
    if (!isRecord(item) || typeof item.id !== "string" || !item.id) continue
    const placement = isRecord(item.placement) && typeof item.placement.eligible === "boolean"
      ? { eligible: item.placement.eligible, reason: typeof item.placement.reason === "string" ? item.placement.reason : null }
      : undefined
    nodes.push({
      id: item.id,
      name: typeof item.name === "string" && item.name ? item.name : item.id,
      isLocal: item.isLocal === true,
      status: typeof item.status === "string" ? item.status : "online",
      confirmed: typeof item.confirmed === "boolean" ? item.confirmed : undefined,
      placement,
      capabilities: Array.isArray(item.capabilities)
        ? item.capabilities.filter(isRecord).filter(c => typeof c.slug === "string").map(c => ({ slug: c.slug as string }))
        : undefined,
      icon: typeof item.icon === "string" ? item.icon : null,
      color: typeof item.color === "string" ? item.color : null,
      os: typeof item.os === "string" ? item.os
        : isRecord(item.platform) && typeof item.platform.os === "string" ? item.platform.os : null,
    })
  }
  return nodes
}

/**
 * Why work cannot go to `node`, in words, or null when it can. The node's own state comes first
 * (revoked, unconfirmed, needs an update, offline), then RedCompute's placement verdict, then
 * whether the node has the capability.
 */
export function runOnUnavailableReason(node: RunOnNode, capability?: RunOnCapability): string | null {
  if (node.status === "revoked") return REASON_WORDS.revoked!
  if (node.confirmed === false || node.status === "pending-confirmation") return REASON_WORDS.not_confirmed!
  if (node.status === "needs-update") return REASON_WORDS.needs_update!
  if (node.status === "offline") return REASON_WORDS.offline!
  if (node.placement && !node.placement.eligible) return words(node.placement.reason ?? "")
  if (capability && node.capabilities && !node.capabilities.some(c => c.slug === capability.slug))
    return `No ${capability.name || capability.slug} here`
  return null
}

/**
 * What the control shows for these nodes. With one node that can run the work it is a read-only row;
 * with two or more, a picker: selectable nodes first (node zero leading, then by name), then the
 * others in server order, disabled with why.
 *
 * `value` is the node already chosen (null: Automatic). A chosen node that can no longer run the work
 * is never dropped silently: the picker shows it, disabled with why, so the person can see it and
 * switch, and a stored choice is not overwritten just by looking at it.
 */
export function runOnView(nodes: readonly RunOnNode[], capability?: RunOnCapability, value: string | null = null): RunOnView {
  const options: RunOnOption[] = nodes.map(node => {
    const reason = runOnUnavailableReason(node, capability)
    return {
      id: node.id, name: node.name, isLocal: node.isLocal, selectable: reason === null, reason,
      status: node.status, icon: node.icon ?? null, color: node.color ?? null, os: node.os ?? null,
    }
  })
  if (value !== null && !options.some(o => o.id === value))
    options.push({ id: value, name: value, isLocal: false, selectable: false, reason: "No longer listed", status: null })
  const selectable = options.filter(o => o.selectable)
    .sort((a, b) => Number(b.isLocal) - Number(a.isLocal) || a.name.localeCompare(b.name))
  const strandedChoice = value !== null && !selectable.some(o => o.id === value)
  if (selectable.length === 0 && !strandedChoice)
    return { mode: "none", message: capability ? `No node can run ${capability.name || capability.slug} right now` : "No node can run work right now" }
  if (selectable.length === 1 && !strandedChoice) return { mode: "single", node: selectable[0]! }
  return {
    mode: "picker",
    automaticLabel: selectable[0] ? `Automatic (${selectable[0].name})` : "Automatic",
    options: [...selectable, ...options.filter(o => !o.selectable)],
  }
}

/**
 * What the compact (icon-only) control says it is, for its tooltip and aria-label: it names the
 * chosen node, with its status, because the trigger shows only an icon.
 */
export function runOnCompactLabel(view: RunOnView, value: string | null): string {
  if (view.mode === "none") return view.message
  const described = (option: RunOnOption) => {
    const status = runOnStatusWords(option.status)
    const state = option.reason ?? status
    return state ? `${option.name} (${state})` : option.name
  }
  if (view.mode === "single") return `Runs on ${described(view.node)}`
  const chosen = value === null ? null : view.options.find(o => o.id === value)
  return `Run on: ${chosen ? described(chosen) : view.automaticLabel}`
}
