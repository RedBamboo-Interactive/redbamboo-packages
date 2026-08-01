import type { HTMLAttributes } from "react"
import { cn } from "../utils"
import { normalizeIcon } from "../icons"

interface IconProps extends HTMLAttributes<HTMLElement> {
  /** Stored icon class string: "ph-bold ph-house", or a legacy FontAwesome class. */
  name: string | null | undefined
  /** Optional entity-supplied SVG path. When present it takes precedence over `name`. */
  svgPath?: string | null
  /** View box for `svgPath`; Simple Icons and most entity icons use 0 0 24 24. */
  svgViewBox?: string
  className?: string
}

/**
 * The one way to render an icon from entity data. Icon strings -- especially
 * ones read from entity data or plugin manifests -- must render through this
 * component so normalizeIcon can translate legacy FontAwesome classes after
 * the icon-font migration. An entity can provide an SVG path when no font icon
 * exists; the renderer remains generic and contains no product-specific marks.
 */
export function Icon({ name, svgPath, svgViewBox = "0 0 24 24", className, ...rest }: IconProps) {
  if (svgPath) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${svgViewBox}"><path d="${svgPath}"/></svg>`
    const maskImage = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`
    return (
      <i
        className={cn("inline-block", className)}
        {...rest}
        style={{
          width: "1em",
          height: "1em",
          backgroundColor: "currentColor",
          mask: `${maskImage} center / contain no-repeat`,
          WebkitMask: `${maskImage} center / contain no-repeat`,
          ...rest.style,
        }}
      />
    )
  }

  if (!name) return null
  return <i className={cn(normalizeIcon(name), className)} {...rest} />
}
