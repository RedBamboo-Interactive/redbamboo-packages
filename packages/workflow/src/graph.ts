export interface WorkflowPortDefinition {
  id: string
  label?: string
  fieldType?: string
  portType?: "data" | "event"
}

export interface WorkflowNodeTypeDefinition {
  typeId: string
  label: string
  icon?: string
  inputs?: WorkflowPortDefinition[]
  outputs?: WorkflowPortDefinition[]
}

export interface WorkflowNode {
  id: string
  type?: string
  position: { x: number; y: number }
  data: {
    label?: string
    config?: Record<string, unknown>
  }
}

export interface WorkflowEdge {
  id?: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

export interface WorkflowGraph {
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

export function normalizeWorkflowGraph(value: unknown): WorkflowGraph {
  let source = value
  if (typeof source === "string") {
    try { source = JSON.parse(source) }
    catch { return { nodes: [], edges: [] } }
  }
  const graph = object(source)
  if (!graph) return { nodes: [], edges: [] }

  const nodes = Array.isArray(graph.nodes) ? graph.nodes.flatMap((candidate): WorkflowNode[] => {
    const node = object(candidate)
    if (!node || typeof node.id !== "string") return []
    const position = object(node.position) ?? {}
    const data = object(node.data) ?? {}
    return [{
      id: node.id,
      type: typeof node.type === "string" ? node.type : undefined,
      position: {
        x: typeof position.x === "number" ? position.x : 0,
        y: typeof position.y === "number" ? position.y : 0,
      },
      data: {
        label: typeof data.label === "string" ? data.label : undefined,
        config: object(data.config),
      },
    }]
  }) : []

  const edges = Array.isArray(graph.edges) ? graph.edges.flatMap((candidate): WorkflowEdge[] => {
    const edge = object(candidate)
    if (!edge || typeof edge.source !== "string" || typeof edge.target !== "string") return []
    return [{
      id: typeof edge.id === "string" ? edge.id : undefined,
      source: edge.source,
      target: edge.target,
      ...(typeof edge.sourceHandle === "string" ? { sourceHandle: edge.sourceHandle } : {}),
      ...(typeof edge.targetHandle === "string" ? { targetHandle: edge.targetHandle } : {}),
    }]
  }) : []

  return { nodes, edges }
}
