import { createContext, useContext, type ReactNode } from "react"

export type ShellLayerRenderer = (position?: string) => ReactNode

const ShellLayerRendererContext = createContext<ShellLayerRenderer | null>(null)
const ShellLayerTargetContext = createContext<string | null>(null)

export function ShellLayerProvider({
  render,
  children,
}: {
  render: ShellLayerRenderer
  children: ReactNode
}) {
  return (
    <ShellLayerRendererContext.Provider value={render}>
      {children}
    </ShellLayerRendererContext.Provider>
  )
}

/**
 * Render enabled shell layers in the current React tree. Portals retain the
 * provider context, so secondary documents can request the same extension
 * layers without importing the contributing plugin directly.
 */
export function ShellLayerOutlet({
  position,
  targetAppId,
}: {
  position?: string
  targetAppId?: string
}) {
  const render = useContext(ShellLayerRendererContext)
  if (!render) return null
  return (
    <ShellLayerTargetContext.Provider value={targetAppId ?? null}>
      {render(position)}
    </ShellLayerTargetContext.Provider>
  )
}

/** Explicit app target supplied by a secondary shell surface, if any. */
export function useShellLayerTargetApp(): string | null {
  return useContext(ShellLayerTargetContext)
}
