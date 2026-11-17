import * as React from "react"

import { cn } from "../utils"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "./select"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"
import {
  parseRunOnNodes,
  RUN_ON_AUTOMATIC,
  RUN_ON_NODES_PATH,
  RUN_ON_SINGLE_HINT,
  runOnView,
  type RunOnCapability,
  type RunOnNode,
  type RunOnOption,
} from "./run-on-choice-core"

/**
 * Reads GET /compute/nodes as the signed-in person: same origin, the kernel's cookie, never a bearer.
 */
export async function fetchRunOnNodes(signal: AbortSignal, path: string = RUN_ON_NODES_PATH): Promise<unknown> {
  const response = await fetch(path, { credentials: "include", signal, headers: { Accept: "application/json" } })
  if (!response.ok) throw new Error(`The node list answered ${response.status}`)
  return response.json()
}

type LoadState =
  | { state: "loading" }
  | { state: "ready"; nodes: RunOnNode[] }
  | { state: "failed"; message: string }

/** The node list, read once when the control mounts. */
function useRunOnNodes(load: (signal: AbortSignal) => Promise<unknown>): LoadState {
  const [result, setResult] = React.useState<LoadState>({ state: "loading" })
  const loader = React.useRef(load)
  loader.current = load
  React.useEffect(() => {
    const controller = new AbortController()
    loader.current(controller.signal)
      .then(body => { if (!controller.signal.aborted) setResult({ state: "ready", nodes: parseRunOnNodes(body) }) })
      .catch(error => {
        if (controller.signal.aborted) return
        setResult({ state: "failed", message: error instanceof Error ? error.message : "The node list could not be read" })
      })
    return () => controller.abort()
  }, [])
  return result
}

export interface RunOnChoiceProps {
  /** The chosen node id; null is Automatic (nothing is sent, the server places the work). */
  value: string | null
  onChange: (nodeId: string | null) => void
  /** The capability the work needs: nodes without it are disabled with "No <name> here". */
  capability?: RunOnCapability
  /** Where the node list comes from; default GET /compute/nodes as the signed-in person. */
  loadNodes?: (signal: AbortSignal) => Promise<unknown>
  disabled?: boolean
  className?: string
  /** For a host `<label htmlFor>` on the picker. */
  id?: string
}

function NodeIcon() {
  return <i aria-hidden className="ph-bold ph-desktop-tower shrink-0 text-[13px]" />
}

function Row({ mode, className, children, ...props }: React.ComponentProps<"div"> & { mode: string }) {
  return (
    <div
      data-slot="run-on-choice"
      data-mode={mode}
      className={cn("flex min-h-8 items-center gap-2 text-sm text-muted-foreground", className)}
      {...props}
    >
      <NodeIcon />
      {children}
    </div>
  )
}

function optionLabel(option: RunOnOption): string {
  return option.reason ? `${option.name} · ${option.reason}` : option.name
}

/**
 * "Run on": where a job, a session or a discussion's sessions run. One node that can run the work is a
 * read-only "Runs on <name>" row; from two up it is a picker with "Automatic" first, and nodes that are
 * offline, not eligible, unconfirmed, revoked or lack the capability are listed disabled with why.
 */
export function RunOnChoice({ value, onChange, capability, loadNodes, disabled, className, id }: RunOnChoiceProps) {
  const loaded = useRunOnNodes(loadNodes ?? (signal => fetchRunOnNodes(signal)))

  if (loaded.state === "loading") return <Row mode="loading" className={className}>Finding nodes…</Row>
  if (loaded.state === "failed")
    return <Row mode="unavailable" className={className} title={loaded.message}>Runs automatically (the node list could not be read)</Row>

  const view = runOnView(loaded.nodes, capability, value)
  if (view.mode === "none") return <Row mode="none" className={className}>{view.message}</Row>
  if (view.mode === "single")
    return (
      <Row mode="single" className={className} data-node-id={view.node.id}>
        <Tooltip>
          <TooltipTrigger
            render={
              <span tabIndex={0} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring-a50"
                aria-label={`Runs on ${view.node.name}. ${RUN_ON_SINGLE_HINT}`} />
            }
          >
            Runs on <span className="font-medium text-foreground/80">{view.node.name}</span>
          </TooltipTrigger>
          <TooltipContent>{RUN_ON_SINGLE_HINT}</TooltipContent>
        </Tooltip>
      </Row>
    )

  const selectable = view.options.filter(o => o.selectable)
  const unavailable = view.options.filter(o => !o.selectable)
  const items = [
    { value: RUN_ON_AUTOMATIC, label: view.automaticLabel },
    ...view.options.map(o => ({ value: o.id, label: optionLabel(o) })),
  ]
  return (
    <div data-slot="run-on-choice" data-mode="picker" className={cn("flex items-center", className)}>
      <Select
        items={items}
        value={value ?? RUN_ON_AUTOMATIC}
        onValueChange={next => onChange(next === null || next === RUN_ON_AUTOMATIC ? null : String(next))}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-label="Run on" data-slot="run-on-choice-trigger" className="min-w-56 max-w-full">
          <span className="flex min-w-0 items-center gap-2">
            <NodeIcon />
            <span className="truncate"><SelectValue /></span>
          </span>
        </SelectTrigger>
        <SelectContent data-slot="run-on-choice-list">
          <SelectItem value={RUN_ON_AUTOMATIC} data-node-id="">{view.automaticLabel}</SelectItem>
          {selectable.map(o => (
            <SelectItem key={o.id} value={o.id} data-node-id={o.id}>{o.name}</SelectItem>
          ))}
          {unavailable.length > 0 && <SelectSeparator />}
          {unavailable.map(o => (
            <SelectItem key={o.id} value={o.id} disabled data-node-id={o.id} data-reason={o.reason ?? undefined}>
              <span className="flex flex-col">
                <span>{o.name}</span>
                <span className="text-xs text-muted-foreground">{o.reason}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
