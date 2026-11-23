import type { SessionInfoNode } from "../types"

/** The shapes of GET /api/nodes that the Info modal reads. Anything else is ignored. */
interface NodeRecord {
  id?: unknown
  name?: unknown
  status?: unknown
  icon?: unknown
  color?: unknown
  agentVersion?: unknown
  /** RedCompute's GET /compute/nodes calls the node agent's version `version`. */
  version?: unknown
  revokedAt?: unknown
  platform?: { os?: unknown; arch?: unknown; architecture?: unknown; chassis?: unknown } | null
}

const OS_NAMES: Record<string, string> = { windows: "Windows", linux: "Linux", macos: "macOS", osx: "macOS", darwin: "macOS" }

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null
}

/** "Windows · x64 desktop": only the parts the node reported. */
function platformLabel(platform: NodeRecord["platform"]): string | null {
  const os = text(platform?.os)
  const arch = text(platform?.arch) ?? text(platform?.architecture)
  const chassis = text(platform?.chassis)
  const system = os ? OS_NAMES[os.toLowerCase()] ?? os : null
  const machine = [arch, chassis].filter(Boolean).join(" ")
  return [system, machine || null].filter(Boolean).join(" · ") || null
}

/**
 * The node a session runs on, from the body of GET /api/nodes (or RedCompute's GET /compute/nodes, which names a
 * few fields differently and carries no icon or colour). `nodeId` is the session's own node. With
 * no node id the session can only be on a node that is the only one; with several, none is named.
 */
export function sessionInfoNodeFrom(body: unknown, nodeId: string | null | undefined, folder?: string | null): SessionInfoNode | null {
  const list = (body as { nodes?: unknown } | null)?.nodes
  if (!Array.isArray(list)) return null
  const nodes = (list as NodeRecord[]).filter(node => node && !node.revokedAt)
  const only = nodes.length === 1
  const node = nodeId ? nodes.find(candidate => candidate.id === nodeId) : only ? nodes[0] : undefined
  const name = text(node?.name)
  if (!node || !name) return null
  return {
    id: text(node.id),
    name,
    icon: text(node.icon),
    color: text(node.color),
    os: text(node.platform?.os),
    chassis: text(node.platform?.chassis),
    platformLabel: platformLabel(node.platform),
    online: typeof node.status === "string" ? node.status === "online" : null,
    agentVersion: text(node.agentVersion) ?? text(node.version),
    folder: folder ?? null,
    onlyNode: only,
  }
}
