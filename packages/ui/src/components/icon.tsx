import type { HTMLAttributes } from "react"
import { cn } from "../utils"
import { normalizeIcon } from "../icons"

interface IconProps extends HTMLAttributes<HTMLElement> {
  /** Stored icon class string: "ph-bold ph-house", or a legacy FontAwesome class. */
  name: string | null | undefined
  className?: string
}

/**
 * The one way to render an icon from a class string. Icon strings -- especially
 * ones read from entity data or plugin manifests -- must render through this
 * component so normalizeIcon can translate legacy FontAwesome classes after
 * the icon-font migration. Renders nothing for a missing name.
 */
export function Icon({ name, className, ...rest }: IconProps) {
  if (!name) return null
  return <i className={cn(normalizeIcon(name), className)} {...rest} />
}
