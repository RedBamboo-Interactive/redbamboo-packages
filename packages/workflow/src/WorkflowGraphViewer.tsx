import { useMemo } from "react"
import {
  Background,
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getSmoothStepPath,
  type EdgeProps,
  type NodeProps,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"
import "./workflow.css"
import {
  normalizeWorkflowGraph,
  type WorkflowGraph,
  type WorkflowNodeTypeDefinition,
  type WorkflowPortDefinition,
} from "./graph"

type ViewerNodeData = Record<string, unknown> & {
  label: string
  definition?: WorkflowNodeTypeDefinition
}

function Port({ port, side, index, count }: {
  port: WorkflowPortDefinition
  side: "input" | "output"
  index: number
  count: number
}) {
  const top = `${((index + 1) / (count + 1)) * 100}%`
  const event = port.portType === "event" || port.fieldType === "event"
  return <>
    <Handle
      type={side === "input" ? "target" : "source"}
      position={side === "input" ? Position.Left : Position.Right}
      id={port.id}
      className={`rb-workflow-port ${event ? "rb-workflow-port-event" : ""}`}
      style={{ top }}
      isConnectable={false}
    />
    <span className={`rb-workflow-port-label rb-workflow-port-label-${side}`} style={{ top }}>
      {port.label ?? port.id}
    </span>
  </>
}

function ViewerNode({ data }: NodeProps) {
  const node = data as ViewerNodeData
  const definition = node.definition
  const inputs = definition?.inputs ?? []
  const outputs = definition?.outputs ?? []
  return <div className="rb-workflow-node">
    <div className="rb-workflow-node-title">
      <i className={definition?.icon ?? "ph-bold ph-gear"} aria-hidden="true" />
      <span>{node.label}</span>
    </div>
    {inputs.map((port, index) => <Port key={`in-${port.id}`} port={port} side="input" index={index} count={inputs.length} />)}
    {outputs.map((port, index) => <Port key={`out-${port.id}`} port={port} side="output" index={index} count={outputs.length} />)}
  </div>
}

function ViewerEdge(props: EdgeProps) {
  const [path] = getSmoothStepPath(props)
  const event = props.targetHandleId === "__event" || props.sourceHandleId === "__event"
  return <BaseEdge {...props} path={path} className={event ? "rb-workflow-edge-event" : "rb-workflow-edge"} />
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
    },
  })), [definitions, graph.nodes])
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
      nodes={nodes}
      edges={edges}
      nodeTypes={types}
      edgeTypes={edgeTypes}
      fitView
      fitViewOptions={{ padding: 0.22, maxZoom: 1.15 }}
      minZoom={0.25}
      maxZoom={1.8}
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
