import { useState, type MouseEventHandler, type ReactNode } from "react"
import { Icon } from "./icon"
import { isPlainEntityActivation, useEntityInteraction } from "./entity-interaction"
import { cn } from "../utils"

export interface EntityCardEntity {
  /** Stable entity identifier used by APIs and direct links. */
  id: string
  /** Entity type slug, for example `agent`, `flow`, or `page`. */
  typeSlug: string
  /** Plain-text entity name used for display and machine discovery. */
  name: string
}

export interface EntityCardVisual {
  src?: string | null
  icon?: string | null
  iconSvgPath?: string | null
  color?: string
  fallbackText?: string
  shape?: "rounded" | "circle"
}

export interface EntityCardDetail {
  label: string
  value: ReactNode
}

export type EntityCardWidth = "quarter" | "half" | "full"

export type EntityCardAction =
  | {
      kind: "inspect"
      href: string
      ariaLabel?: string
      /** Lets a containing modal release its focus trap after emitting the intent. */
      onInspect?: () => void
    }
  | {
      kind: "link"
      href: string
      ariaLabel?: string
      target?: string
      rel?: string
      onClick?: MouseEventHandler<HTMLAnchorElement>
    }
  | {
      kind: "button"
      onActivate: () => void
      ariaLabel?: string
    }

export interface EntityIdentityProps {
  entity: EntityCardEntity
  visual?: EntityCardVisual
  subtitle?: ReactNode
  details?: readonly EntityCardDetail[]
  badge?: ReactNode
  size?: "sm" | "md"
  className?: string
}

export interface EntityCardProps extends Omit<EntityIdentityProps, "className"> {
  variant?: "row" | "outlined"
  /** Deliberate layout tier. Block cards become full-width below the sm breakpoint. */
  width?: EntityCardWidth
  action?: EntityCardAction
  selected?: boolean
  current?: boolean
  disabled?: boolean
  trailing?: ReactNode
  actions?: ReactNode
  className?: string
}

export interface EntityCardDescriptor {
  id: string
  typeSlug: string
  name: string
  href?: string
  actionKind?: EntityCardAction["kind"]
  width: EntityCardWidth
  selected: boolean
  inspected: boolean
  current: boolean
  disabled: boolean
  focused: boolean
  visible: boolean
  element: HTMLElement
}

/**
 * Canonical entity identity anatomy for custom surfaces such as workspace tiles
 * and rich embeds. Use `EntityCard` for the normal compact reference surface.
 */
export function EntityIdentity({
  entity,
  visual,
  subtitle,
  details,
  badge,
  size = "sm",
  className,
}: EntityIdentityProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const hasImageFrame = !!visual?.src || !!visual?.fallbackText
  const showImage = !!visual?.src && failedSrc !== visual.src
  const mediaSize = size === "md" ? "size-9" : "size-8"
  const iconWidth = size === "md" ? "w-6" : "w-5"
  const imageShape = visual?.shape === "circle" ? "rounded-full" : "rounded"
  const fallback = visual?.fallbackText?.trim().slice(0, 1).toUpperCase() || entity.name[0]?.toUpperCase() || "?"

  return (
    <div
      data-slot="entity-identity"
      data-entity-id={entity.id}
      data-entity-type={entity.typeSlug}
      data-entity-name={entity.name}
      className={cn("flex min-w-0 flex-1 items-center gap-3", className)}
    >
      {visual && (
        <div
          data-slot="entity-media"
          className={cn(
            "shrink-0",
            hasImageFrame ? mediaSize : cn(iconWidth, "text-center"),
          )}
        >
          {showImage ? (
            <img
              src={visual.src!}
              alt=""
              className={cn(mediaSize, imageShape, "object-cover")}
              onError={() => setFailedSrc(visual.src ?? null)}
            />
          ) : hasImageFrame ? (
            <span
              aria-hidden="true"
              className={cn(
                mediaSize,
                imageShape,
                "flex items-center justify-center bg-overlay-10 text-sm font-medium text-text-muted",
              )}
            >
              {fallback}
            </span>
          ) : (
            <Icon
              name={visual.icon}
              svgPath={visual.iconSvgPath}
              aria-hidden="true"
              className="text-sm"
              style={visual.color ? { color: visual.color } : undefined}
            />
          )}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span
            data-slot="entity-name"
            className={cn(
              "truncate font-medium text-contrast",
              size === "md" ? "text-sm" : "text-[13px]",
            )}
          >
            {entity.name}
          </span>
          {badge && <span data-slot="entity-badge" className="shrink-0">{badge}</span>}
        </div>

        {subtitle && (
          <div data-slot="entity-subtitle" className="truncate text-[11px] text-text-muted">
            {subtitle}
          </div>
        )}

        {details && details.length > 0 && (
          <div data-slot="entity-details" className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
            {details.map((detail) => (
              <span
                key={detail.label}
                data-slot="entity-detail"
                data-detail-label={detail.label}
                className="truncate text-[11px] text-text-muted"
                aria-label={typeof detail.value === "string" ? `${detail.label}: ${detail.value}` : detail.label}
              >
                {detail.value}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Canonical compact entity reference. It exposes a stable semantic DOM contract
 * for browser agents and Playwright while keeping RedLeaf data and routing out
 * of the design system.
 */
export function EntityCard({
  entity,
  visual,
  subtitle,
  details,
  badge,
  size = "sm",
  variant = "row",
  width = "full",
  action,
  selected = false,
  current = false,
  disabled = false,
  trailing,
  actions,
  className,
}: EntityCardProps) {
  const interaction = useEntityInteraction()
  const href = action?.kind === "link" || action?.kind === "inspect" ? action.href : undefined
  const inspected = action?.kind === "inspect" && interaction?.inspectedEntityId === entity.id
  const active = selected || inspected
  const primaryClassName = cn(
    "min-w-0 flex-1 text-left outline-none transition-opacity",
    action && !disabled && "hover:opacity-80 focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    disabled && "cursor-default",
  )

  const identity = (
    <EntityIdentity
      entity={entity}
      visual={visual}
      subtitle={subtitle}
      details={details}
      badge={badge}
      size={size}
    />
  )

  let primary: ReactNode
  if (action?.kind === "inspect" && !disabled) {
    const handleInspect: MouseEventHandler<HTMLAnchorElement> = (event) => {
      if (!interaction || !isPlainEntityActivation(event)) return
      event.preventDefault()
      interaction.inspect({ entity, href: action.href, trigger: event.currentTarget })
      action.onInspect?.()
    }
    primary = (
      <a
        data-slot="entity-card-primary"
        href={action.href}
        onClick={handleInspect}
        aria-label={action.ariaLabel}
        aria-expanded={inspected || undefined}
        className={primaryClassName}
      >
        {identity}
      </a>
    )
  } else if (action?.kind === "link" && !disabled) {
    primary = (
      <a
        data-slot="entity-card-primary"
        href={action.href}
        target={action.target}
        rel={action.rel}
        onClick={action.onClick}
        aria-label={action.ariaLabel}
        aria-current={current ? "page" : undefined}
        className={primaryClassName}
      >
        {identity}
      </a>
    )
  } else if (action?.kind === "button" && !disabled) {
    primary = (
      <button
        data-slot="entity-card-primary"
        type="button"
        onClick={action.onActivate}
        aria-label={action.ariaLabel}
        aria-pressed={selected || undefined}
        className={primaryClassName}
      >
        {identity}
      </button>
    )
  } else {
    primary = (
      <div data-slot="entity-card-primary" className={primaryClassName}>
        {identity}
      </div>
    )
  }

  return (
    <div
      data-slot="entity-card"
      data-entity-id={entity.id}
      data-entity-type={entity.typeSlug}
      data-entity-name={entity.name}
      data-entity-href={href}
      data-entity-action={action?.kind}
      data-entity-width={width}
      data-selected={selected || undefined}
      data-inspected={inspected || undefined}
      data-current={current || undefined}
      data-disabled={disabled || undefined}
      aria-disabled={disabled || undefined}
      className={cn(
        "group/entity-card flex items-center gap-3 px-3 py-2.5 transition-colors",
        width === "quarter" && "w-full sm:w-1/4",
        width === "half" && "w-full sm:w-1/2",
        width === "full" && "w-full",
        variant === "outlined"
          ? "overflow-hidden rounded-md border border-overlay-6 bg-overlay-4/50"
          : "border-overlay-6",
        active && variant === "outlined" && "bg-overlay-6",
        active && variant === "row" && "border-l-2 border-primary bg-overlay-6 pl-[calc(0.75rem_-_2px)]",
        action && !disabled && variant === "outlined" && "hover:border-overlay-10 hover:bg-overlay-4",
        action && !disabled && variant === "row" && !active && "hover:bg-overlay-4",
        disabled && "pointer-events-none opacity-60",
        className,
      )}
    >
      {primary}
      {trailing && (
        <div data-slot="entity-trailing" className="flex shrink-0 items-center gap-2">
          {trailing}
        </div>
      )}
      {actions && (
        <div data-slot="entity-actions" className="flex shrink-0 items-center gap-1 self-center">
          {actions}
        </div>
      )}
    </div>
  )
}

/** Query the mounted semantic entity-card contract without depending on CSS classes. */
export function queryEntityCards(root?: ParentNode): EntityCardDescriptor[] {
  if (!root && typeof document === "undefined") return []
  const scope = root ?? document
  const descendants = Array.from(scope.querySelectorAll<HTMLElement>('[data-slot="entity-card"]'))
  const elements = typeof HTMLElement !== "undefined"
    && scope instanceof HTMLElement
    && scope.matches('[data-slot="entity-card"]')
    ? [scope, ...descendants]
    : descendants
  return elements.map((element) => ({
    id: element.dataset.entityId ?? "",
    typeSlug: element.dataset.entityType ?? "",
    name: element.dataset.entityName ?? "",
    href: element.dataset.entityHref || undefined,
    actionKind: element.dataset.entityAction as EntityCardAction["kind"] | undefined,
    width: element.dataset.entityWidth === "quarter" || element.dataset.entityWidth === "half"
      ? element.dataset.entityWidth
      : "full",
    selected: element.hasAttribute("data-selected"),
    inspected: element.hasAttribute("data-inspected"),
    current: element.hasAttribute("data-current"),
    disabled: element.hasAttribute("data-disabled"),
    focused: element.matches(":focus-within"),
    visible: element.getClientRects().length > 0,
    element,
  }))
}
