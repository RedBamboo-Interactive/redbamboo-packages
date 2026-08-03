import type { CSSProperties, ReactNode } from "react"
import { Handle, Position } from "@xyflow/react"

export interface WorkflowNodePortPresentation {
  id: string
  label?: string
  title?: string
  color?: string
  handleOpacity?: number
  labelOpacity?: number
  handleSize?: number
  glow?: boolean
}

export interface WorkflowEventInputPresentation {
  opacity?: number
  glow?: boolean
}

export interface WorkflowNodeSurfaceProps {
  label: string
  icon?: ReactNode
  headerActions?: ReactNode
  inputs?: WorkflowNodePortPresentation[]
  outputs?: WorkflowNodePortPresentation[]
  eventInput?: WorkflowEventInputPresentation | false
  width?: number
  className?: string
  cardClassName?: string
  style?: CSSProperties
  contentStyle?: CSSProperties
  cardStyle?: CSSProperties
  cardTop?: number
  backgroundContent?: ReactNode
  children?: ReactNode
}

function PortHandle({ port, side }: { port: WorkflowNodePortPresentation; side: "input" | "output" }) {
  const size = port.handleSize ?? 10
  const color = port.color ?? "var(--color-text-disabled, var(--text-muted, #81838c))"
  return (
    <Handle
      type={side === "input" ? "target" : "source"}
      position={side === "input" ? Position.Left : Position.Right}
      id={port.id}
      title={port.title}
      className="rb-workflow-node-port"
      style={{
        width: size,
        height: size,
        [side === "input" ? "left" : "right"]: -12,
        backgroundColor: color,
        opacity: port.handleOpacity ?? 1,
        ...(port.glow ? { boxShadow: `0 0 6px 2px ${color}` } : undefined),
      }}
    />
  )
}

export function WorkflowNodeSurface({
  label,
  icon,
  headerActions,
  inputs = [],
  outputs = [],
  eventInput = false,
  width = 180,
  className,
  cardClassName,
  style,
  contentStyle,
  cardStyle,
  cardTop = 0,
  backgroundContent,
  children,
}: WorkflowNodeSurfaceProps) {
  const rows = Math.max(inputs.length, outputs.length)
  return (
    <div className={`rb-workflow-node-surface ${className ?? ""}`} style={{ width, ...style }}>
      <div
        className={`rb-workflow-node-card ${cardClassName ? cardClassName : "rb-workflow-node-card-default"}`}
        style={{ top: cardTop, ...cardStyle }}
      >
        {eventInput && (
          <Handle
            type="target"
            position={Position.Top}
            id="__event"
            title="Event input"
            className="rb-workflow-node-event-port"
            style={{
              opacity: eventInput.opacity ?? 0.5,
              ...(eventInput.glow ? { boxShadow: "0 0 6px 2px var(--color-accent-gold, #bd9850)" } : undefined),
            }}
          />
        )}
        {backgroundContent}
      </div>

      <div className="rb-workflow-node-content" style={contentStyle}>
        <div className="rb-workflow-node-header">
          <span className="rb-workflow-node-icon">{icon ?? <i className="ph-bold ph-gear" aria-hidden="true" />}</span>
          <span className="rb-workflow-node-label">{label}</span>
          {headerActions && <span className="rb-workflow-node-actions">{headerActions}</span>}
        </div>

        <div className="rb-workflow-node-ports">
          {Array.from({ length: rows }, (_, index) => {
            const input = inputs[index]
            const output = outputs[index]
            return (
              <div className="rb-workflow-node-port-row" key={index}>
                <span className="rb-workflow-node-port-label rb-workflow-node-port-label-input" style={{ opacity: input?.labelOpacity ?? 1 }}>
                  {input?.label ?? ""}
                </span>
                <span className="rb-workflow-node-port-label rb-workflow-node-port-label-output" style={{ opacity: output?.labelOpacity ?? 1 }}>
                  {output?.label ?? ""}
                </span>
                {input && <PortHandle port={input} side="input" />}
                {output && <PortHandle port={output} side="output" />}
              </div>
            )
          })}
        </div>
        {children}
      </div>
    </div>
  )
}
