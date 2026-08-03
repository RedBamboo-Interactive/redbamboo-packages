import { BaseEdge, getSmoothStepPath, type EdgeProps } from "@xyflow/react"

export function WorkflowSmoothStepEdge({
  id,
  sourceX,
  sourceY,
  sourcePosition,
  targetX,
  targetY,
  targetPosition,
  style,
  markerEnd,
  markerStart,
}: EdgeProps) {
  const [path] = getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return <BaseEdge id={id} path={path} style={style} markerEnd={markerEnd} markerStart={markerStart} />
}
