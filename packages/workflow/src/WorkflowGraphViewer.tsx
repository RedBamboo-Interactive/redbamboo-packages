import { useMemo } from "react"
import {
  Background,
  ReactFlow,
  ReactFlowProvider,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import "./workflow.css"
import {
  normalizeWorkflowGraph,
  type WorkflowGraph,
  type WorkflowNodeTypeDefinition,
} from "./graph"
import { WorkflowNodeSurface, type WorkflowNodePortPresentation } from "./WorkflowNodeSurface"
import { WorkflowSmoothStepEdge } from "./WorkflowSmoothStepEdge"

type ViewerNodeData = Record<string, unknown> & {
  label: string
  definition?: WorkflowNodeTypeDefinition
  eventInput?: boolean
}

function presentPorts(ports: WorkflowNodeTypeDefinition["inputs"]): WorkflowNodePortPresentation[] {
  return (ports ?? []).map(port => ({
    id: port.id,
    label: port.label ?? port.id,
    title: port.fieldType,
    color: port.portType === "event" || port.fieldType === "event"
      ? "var(--color-accent-gold, #bd9850)"
      : undefined,
  }))
}

function ViewerNode({ data }: NodeProps) {
  const node = data as ViewerNodeData
  const definition = node.definition
  return <WorkflowNodeSurface
    label={node.label}
    icon={<i className={definition?.icon ?? "ph-bold ph-gear"} aria-hidden="true" />}
    inputs={presentPorts(definition?.inputs)}
    outputs={presentPorts(definition?.outputs)}
    eventInput={node.eventInput ? { opacity: 0.5 } : false}
  />
}

function ViewerEdge(props: EdgeProps) {
  const event = props.targetHandleId === "__event" || props.sourceHandleId === "__event"
  return <WorkflowSmoothStepEdge
    {...props}
    style={event
      ? { ...props.style, stroke: "var(--color-accent-gold, #bd9850)", strokeWidth: 2, strokeDasharray: "6 3", opacity: 0.7 }
      : { ...props.style, stroke: "var(--border, #8b8d96)", strokeWidth: 2 }}
  />
}

export interface WorkflowGraphViewerProps {
  graph: WorkflowGraph | unknown
  nodeTypes?: WorkflowNodeTypeDefinition[]
  className?: string
  ariaLabel?: string
  minHeight?: number | string
}

function Viewer({ graph: source, nodeTypes = [], className, ariaLabel, minHeight = 320 }: WorkflowGraphViewerProps) {
  const graph = useMemo(() => normalizeWorkflowGraph(source), [source])
  const definitions = useMemo(() => new Map(nodeTypes.map(item => [item.typeId, item])), [nodeTypes])
  const nodes = useMemo(() => graph.nodes.map(node => ({
    ...node,
    type: "workflowNode",
    draggable: false,
    selectable: false,
    data: {
      ...node.data,
      label: node.data.label ?? definitions.get(node.type ?? "")?.label ?? node.type ?? node.id,
      definition: definitions.get(node.type ?? ""),
      eventInput: graph.edges.some(edge => edge.target === node.id && edge.targetHandle === "__event"),
    },
  })), [definitions, graph.edges, graph.nodes])
  const edges = useMemo(() => graph.edges.map((edge, index) => ({
    ...edge,
    id: edge.id ?? `${edge.source}-${edge.target}-${index}`,
    type: "workflowEdge",
  })), [graph.edges])
  const types = useMemo(() => ({ workflowNode: ViewerNode }), [])
  const edgeTypes = useMemo(() => ({ workflowEdge: ViewerEdge }), [])

  if (nodes.length === 0) return <div className="rb-workflow-empty">This workflow has no visible graph.</div>

  return <div className={`rb-workflow-viewer ${className ?? ""}`} style={{ minHeight }} role="img" aria-label={ariaLabel ?? "Workflow graph"}>
    <ReactFlow
      style={{ minHeight }}
      nodes={nodes}
      edges={edges}
      nodeTypes={types}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.25}
      maxZoom={2}
      nodesDraggable={false}
      nodesConnectable={false}
      elementsSelectable={false}
      deleteKeyCode={null}
      proOptions={{ hideAttribution: true }}
    >
      <Background gap={20} size={1} color="var(--rb-workflow-grid, rgba(255,255,255,.06))" />
    </ReactFlow>
  </div>
}

export function WorkflowGraphViewer(props: WorkflowGraphViewerProps) {
  return <ReactFlowProvider><Viewer {...props} /></ReactFlowProvider>
}
