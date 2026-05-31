import { useContext } from "react"
import type { BreadcrumbItem } from "@redbamboo/ui"
import { BreadcrumbLabelContext } from "./breadcrumb-labels"

export interface RouteHandle {
  crumb?: string | ((params: Record<string, string>) => string)
  icon?: string
}

export interface RouteMatch {
  pathname: string
  params: Record<string, string>
  handle?: unknown
}

export function buildBreadcrumbs(
  matches: RouteMatch[],
  labels?: Map<string, { label: string; icon?: string }> | null,
): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = []

  for (const match of matches) {
    const handle = match.handle as RouteHandle | undefined
    if (!handle?.crumb) continue

    const override = labels?.get(match.pathname)

    const label = override?.label
      ?? (typeof handle.crumb === "function"
        ? handle.crumb(match.params)
        : handle.crumb)

    const icon = override?.icon ?? handle.icon

    items.push({ label, icon, href: match.pathname })
  }

  if (items.length > 0) {
    delete items[items.length - 1].href
  }

  return items
}

export function useBreadcrumbLabelsContext() {
  return useContext(BreadcrumbLabelContext)
}
