import * as React from "react"
import { Select as SelectPrimitive } from "@base-ui/react/select"

import { cn } from "../utils"
import { NODE_AUTOMATIC_ICON, nodeIconClass, nodeIdentity, type NodeLook } from "./node-identity"
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "./select"
import { Tooltip, TooltipContent, TooltipTrigger } from "./tooltip"
import {
  parseRunOnNodes,
  RUN_ON_AUTOMATIC,
  RUN_ON_NODES_PATH,
  RUN_ON_SINGLE_HINT,
  runOnCompactLabel,
  runOnView,
  type RunOnCapability,
  type RunOnNode,
  type RunOnOption,
  type RunOnView,
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
  /**
   * Icon only, for a toolbar line: the trigger shows the chosen node's icon in its colour (Automatic
   * its own icon); the name and status are in its tooltip and aria-label; a click opens the list.
   * With one node it is the icon alone, not a button.
   */
  compact?: boolean
}

export interface NodeIconProps extends NodeLook {
  className?: string
  /** Muted whatever the node's colour (a disabled entry). */
  muted?: boolean
}

/**
 * A node's icon in its colour (see node-identity), or its platform's logo in a neutral colour when it
 * has none. Decorative: the host names the node in text or an aria-label.
 */
export function NodeIcon({ icon, color, os, className, muted }: NodeIconProps) {
  const look = nodeIdentity({ icon, color, os })
  return (
    <i
      aria-hidden
      data-slot="node-icon"
      data-icon={look.icon}
      data-color={look.color?.token ?? ""}
      className={cn(nodeIconClass(look.icon), "shrink-0 text-[13px]", (muted || !look.color) && "text-muted-foreground", className)}
      style={!muted && look.color ? { color: look.color.hex } : undefined}
    />
  )
}

function AutomaticIcon({ className }: { className?: string }) {
  return (
    <i aria-hidden data-slot="node-icon" data-icon={NODE_AUTOMATIC_ICON}
      className={cn(nodeIconClass(NODE_AUTOMATIC_ICON), "shrink-0 text-[13px] text-muted-foreground", className)} />
  )
}

function Row({ mode, className, children, icon, ...props }: React.ComponentProps<"div"> & { mode: string; icon?: React.ReactNode }) {
  return (
    <div
      data-slot="run-on-choice"
      data-mode={mode}
      className={cn("flex min-h-8 items-center gap-2 text-sm text-muted-foreground", className)}
      {...props}
    >
      {icon ?? <i aria-hidden className="ph-bold ph-desktop-tower shrink-0 text-[13px]" />}
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
 * `compact` draws the same choice as an icon for a toolbar line.
 */
export function RunOnChoice({ value, onChange, capability, loadNodes, disabled, className, id, compact }: RunOnChoiceProps) {
  const loaded = useRunOnNodes(loadNodes ?? (signal => fetchRunOnNodes(signal)))

  if (compact)
    return <CompactRunOnChoice loaded={loaded} value={value} onChange={onChange} capability={capability}
      disabled={disabled} className={className} id={id} />

  if (loaded.state === "loading") return <Row mode="loading" className={className}>Finding nodes…</Row>
  if (loaded.state === "failed")
    return <Row mode="unavailable" className={className} title={loaded.message}>Runs automatically (the node list could not be read)</Row>

  const view = runOnView(loaded.nodes, capability, value)
  if (view.mode === "none") return <Row mode="none" className={className}>{view.message}</Row>
  if (view.mode === "single")
    return (
      <Row mode="single" className={className} data-node-id={view.node.id} icon={<OptionIcon option={view.node} />}>
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
  return (
    <div data-slot="run-on-choice" data-mode="picker" className={cn("flex items-center", className)}>
      <Select
        items={selectItems(view)}
        value={value ?? RUN_ON_AUTOMATIC}
        onValueChange={next => onChange(next === null || next === RUN_ON_AUTOMATIC ? null : String(next))}
        disabled={disabled}
      >
        <SelectTrigger id={id} aria-label="Run on" data-slot="run-on-choice-trigger" className="min-w-56 max-w-full">
          <span className="flex min-w-0 items-center gap-2">
            <ChosenIcon view={view} value={value} />
            <span className="truncate"><SelectValue /></span>
          </span>
        </SelectTrigger>
        <SelectContent data-slot="run-on-choice-list">
          <RunOnItems automaticLabel={view.automaticLabel} selectable={selectable} unavailable={unavailable} />
        </SelectContent>
      </Select>
    </div>
  )
}

function selectItems(view: Extract<RunOnView, { mode: "picker" }>) {
  return [
    { value: RUN_ON_AUTOMATIC, label: view.automaticLabel },
    ...view.options.map(o => ({ value: o.id, label: optionLabel(o) })),
  ]
}

/** A node's icon in the trigger and the list: its own icon and colour when the node list carries them. */
function OptionIcon({ option, muted, className }: { option: RunOnOption; muted?: boolean; className?: string }) {
  return <NodeIcon icon={option.icon} color={option.color} os={option.os} muted={muted} className={className} />
}

/** The chosen node's icon, or Automatic's. */
function ChosenIcon({ view, value, className }: { view: RunOnView; value: string | null; className?: string }) {
  if (view.mode === "single") return <OptionIcon option={view.node} className={className} />
  const chosen = view.mode === "picker" && value !== null ? view.options.find(o => o.id === value) : undefined
  return chosen ? <OptionIcon option={chosen} className={className} /> : <AutomaticIcon className={className} />
}

/** The list: Automatic first, the nodes that can run the work, then the others disabled with why. */
function RunOnItems({ automaticLabel, selectable, unavailable }: {
  automaticLabel: string
  selectable: RunOnOption[]
  unavailable: RunOnOption[]
}) {
  return (
    <>
      <SelectItem value={RUN_ON_AUTOMATIC} data-node-id="">
        <span className="flex items-center gap-2"><AutomaticIcon />{automaticLabel}</span>
      </SelectItem>
      {selectable.map(o => (
        <SelectItem key={o.id} value={o.id} data-node-id={o.id}>
          <span className="flex items-center gap-2"><OptionIcon option={o} />{o.name}</span>
        </SelectItem>
      ))}
      {unavailable.length > 0 && <SelectSeparator />}
      {unavailable.map(o => (
        <SelectItem key={o.id} value={o.id} disabled data-node-id={o.id} data-reason={o.reason ?? undefined}>
          <span className="flex items-center gap-2">
            <OptionIcon option={o} muted />
            <span className="flex flex-col">
              <span>{o.name}</span>
              <span className="text-xs text-muted-foreground">{o.reason}</span>
            </span>
          </span>
        </SelectItem>
      ))}
    </>
  )
}

const COMPACT_BOX =
  "inline-flex h-7 min-w-7 items-center justify-center gap-0.5 rounded-md px-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring-a50"

/** An icon with a tooltip that is not a button (loading, unreadable list, no node, one node). */
function CompactStatic({ mode, label, hint, className, nodeId, children }: {
  mode: string
  label: string
  hint?: string
  className?: string
  nodeId?: string
  children: React.ReactNode
}) {
  return (
    <span data-slot="run-on-choice" data-mode={mode} data-compact="" data-node-id={nodeId} className={cn("inline-flex", className)}>
      <Tooltip>
        <TooltipTrigger
          render={
            <span tabIndex={0} role="img" aria-label={hint ? `${label}. ${hint}` : label}
              data-slot="run-on-choice-trigger" className={COMPACT_BOX} />
          }
        >
          {children}
        </TooltipTrigger>
        <TooltipContent>
          <span className="flex flex-col gap-0.5">
            <span>{label}</span>
            {hint && <span className="opacity-70">{hint}</span>}
          </span>
        </TooltipContent>
      </Tooltip>
    </span>
  )
}

function CompactRunOnChoice({ loaded, value, onChange, capability, disabled, className, id }: {
  loaded: LoadState
  value: string | null
  onChange: (nodeId: string | null) => void
  capability?: RunOnCapability
  disabled?: boolean
  className?: string
  id?: string
}) {
  if (loaded.state === "loading")
    return (
      <CompactStatic mode="loading" label="Finding nodes…" className={className}>
        <AutomaticIcon className="opacity-50" />
      </CompactStatic>
    )
  if (loaded.state === "failed")
    return (
      <CompactStatic mode="unavailable" label="Runs automatically" hint={`The node list could not be read (${loaded.message})`}
        className={className}>
        <AutomaticIcon />
      </CompactStatic>
    )
  const view = runOnView(loaded.nodes, capability, value)
  const label = runOnCompactLabel(view, value)
  if (view.mode === "none")
    return <CompactStatic mode="none" label={label} className={className}><AutomaticIcon /></CompactStatic>
  if (view.mode === "single")
    return (
      <CompactStatic mode="single" label={label} hint={RUN_ON_SINGLE_HINT} className={className} nodeId={view.node.id}>
        <ChosenIcon view={view} value={value} />
      </CompactStatic>
    )

  const selectable = view.options.filter(o => o.selectable)
  const unavailable = view.options.filter(o => !o.selectable)
  return (
    <span data-slot="run-on-choice" data-mode="picker" data-compact="" className={cn("inline-flex", className)}>
      <Select
        items={selectItems(view)}
        value={value ?? RUN_ON_AUTOMATIC}
        onValueChange={next => onChange(next === null || next === RUN_ON_AUTOMATIC ? null : String(next))}
        disabled={disabled}
      >
        <Tooltip>
          <TooltipTrigger
            render={
              <SelectPrimitive.Trigger
                id={id}
                aria-label={label}
                data-slot="run-on-choice-trigger"
                className={cn(COMPACT_BOX,
                  "text-muted-foreground hover:bg-muted data-popup-open:bg-muted disabled:cursor-not-allowed disabled:opacity-50")}
              />
            }
          >
            <ChosenIcon view={view} value={value} />
            <i aria-hidden className="ph-bold ph-caret-down text-[9px] opacity-60" />
          </TooltipTrigger>
          <TooltipContent>{label}</TooltipContent>
        </Tooltip>
        <SelectContent data-slot="run-on-choice-list" alignItemWithTrigger={false} className="min-w-56">
          <RunOnItems automaticLabel={view.automaticLabel} selectable={selectable} unavailable={unavailable} />
        </SelectContent>
      </Select>
    </span>
  )
}
