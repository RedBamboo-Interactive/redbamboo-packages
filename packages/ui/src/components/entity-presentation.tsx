import { createContext, useContext, useEffect, useState, type ReactNode } from "react"
import type { EntityCardEntity, EntityCardVisual } from "./entity-card"

export interface EntityCardPresentation {
  entity: EntityCardEntity
  subtitle?: string
  visual?: EntityCardVisual
}

export type EntityPresentationResolver = (
  entity: EntityCardEntity,
  signal: AbortSignal,
) => Promise<EntityCardPresentation | null>

export interface EntityPresentationProviderProps {
  resolve: EntityPresentationResolver
  children: ReactNode
}

const EntityPresentationContext = createContext<EntityPresentationResolver | null>(null)

/**
 * Host bridge for permission-scoped entity presentation. The design system owns
 * the async lifecycle while the host remains responsible for authorization and data.
 */
export function EntityPresentationProvider({
  resolve,
  children,
}: EntityPresentationProviderProps) {
  return (
    <EntityPresentationContext.Provider value={resolve}>
      {children}
    </EntityPresentationContext.Provider>
  )
}

/**
 * Hydrates a stable entity identity into its host-provided canonical presentation.
 * A missing provider, failed lookup, or denied entity leaves the caller's fallback intact.
 */
export function useEntityCardPresentation(
  entity: EntityCardEntity | null,
): EntityCardPresentation | null {
  const resolve = useContext(EntityPresentationContext)
  const id = entity?.id
  const typeSlug = entity?.typeSlug
  const name = entity?.name
  const key = id && typeSlug ? `${typeSlug}:${id}` : null
  const [state, setState] = useState<{
    key: string
    presentation: EntityCardPresentation | null
  } | null>(null)

  useEffect(() => {
    if (!resolve || !id || !typeSlug || !name || !key) return
    const controller = new AbortController()
    let current = true

    Promise.resolve()
      .then(() => resolve({ id, typeSlug, name }, controller.signal))
      .then((presentation) => {
        if (current && !controller.signal.aborted)
          setState({ key, presentation })
      })
      .catch((cause: unknown) => {
        if (!current || controller.signal.aborted) return
        if (typeof DOMException !== "undefined"
            && cause instanceof DOMException
            && cause.name === "AbortError") return
        setState({ key, presentation: null })
      })

    return () => {
      current = false
      controller.abort()
    }
  }, [id, key, name, resolve, typeSlug])

  return state?.key === key ? state.presentation : null
}
