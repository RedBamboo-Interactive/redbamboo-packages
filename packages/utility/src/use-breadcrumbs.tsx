import { useContext, useEffect } from "react"
import type { BreadcrumbItem } from "@redbamboo/ui"
import { BreadcrumbLabelContext, type PluginCrumb } from "./breadcrumb-labels"

export interface RouteHandle {
  crumb?: string | ((params: Record<string, string>) => string)
  icon?: string
}

export interface RouteMatch {
  pathname: string
  params: Record<string, string>
  handle?: unknown
}

export interface PluginRoute {
  path?: string
  handle?: RouteHandle
  children?: PluginRoute[]
}

export function buildBreadcrumbs(
  matches: RouteMatch[],
  labels?: Map<string, { label: string; icon?: string }> | null,
): BreadcrumbItem[] {
  const items: BreadcrumbItem[] = []

  for (const match of matches) {
    const handle = match.handle as RouteHandle | undefined
    if (!handle?.crumb) continue

    let resolvedPath = match.pathname
    const splat = match.params["*"]
    if (splat) {
      resolvedPath = match.pathname.slice(0, -(splat.length + 1)) || "/"
    }

    const override = labels?.get(resolvedPath)

    const label = override?.label
      ?? (typeof handle.crumb === "function"
        ? handle.crumb(match.params)
        : handle.crumb)

    const icon = override?.icon ?? handle.icon

    items.push({ label, icon, href: resolvedPath })
  }

  return items
}

export function useBreadcrumbLabelsContext() {
  return useContext(BreadcrumbLabelContext)
}

function matchSegments(
  routes: PluginRoute[],
  segments: string[],
  depth: number,
  basePath: string,
  labels: Map<string, { label: string; icon?: string }> | null | undefined,
): PluginCrumb[] {
  const results: PluginCrumb[] = []

  for (const route of routes) {
    if (!route.path) {
      if (route.children) {
        return matchSegments(route.children, segments, depth, basePath, labels)
      }
      continue
    }

    if (route.path === "*") continue

    const seg = segments[depth]
    if (seg === undefined) continue

    const isParam = route.path.startsWith(":")
    if (!isParam && route.path !== seg) continue

    const params: Record<string, string> = {}
    if (isParam) params[route.path.slice(1)] = seg

    const href = basePath + "/" + segments.slice(0, depth + 1).join("/")

    if (route.handle?.crumb) {
      const override = labels?.get(href)
      const label = override?.label
        ?? (typeof route.handle.crumb === "function"
          ? route.handle.crumb(params)
          : route.handle.crumb)
      const icon = override?.icon ?? route.handle.icon
      results.push({ label, icon, href })
    }

    if (route.children && depth + 1 < segments.length) {
      results.push(...matchSegments(route.children, segments, depth + 1, basePath, labels))
    }

    break
  }

  return results
}

export function usePluginBreadcrumbs(
  routes: PluginRoute[],
  basePath: string,
  pathname: string,
): void {
  const ctx = useContext(BreadcrumbLabelContext)
  const labels = ctx?.labels
  const setPluginCrumbs = ctx?.setPluginCrumbs

  useEffect(() => {
    if (!setPluginCrumbs) return

    const relative = pathname.startsWith(basePath)
      ? pathname.slice(basePath.length)
      : ""
    const segments = relative.split("/").filter(Boolean)

    const items = segments.length > 0
      ? matchSegments(routes, segments, 0, basePath, labels)
      : []

    setPluginCrumbs(items)
    return () => setPluginCrumbs([])
  }, [pathname, routes, basePath, labels, setPluginCrumbs])
}
