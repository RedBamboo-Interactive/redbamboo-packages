import { createContext, useContext, useMemo, type ReactNode } from "react"
import type { EntityCardEntity } from "./entity-card"

export interface EntityInspectRequest {
  entity: EntityCardEntity
  href: string
  trigger: HTMLElement
}

export interface EntityInteractionValue {
  inspectedEntityId?: string
  inspect: (request: EntityInspectRequest) => void
}

export interface EntityInteractionProviderProps extends EntityInteractionValue {
  children: ReactNode
}

const EntityInteractionContext = createContext<EntityInteractionValue | null>(null)

/**
 * Host bridge for canonical entity inspection. The design system only carries
 * structured intent; the host remains responsible for routing, data and UI.
 */
export function EntityInteractionProvider({
  inspectedEntityId,
  inspect,
  children,
}: EntityInteractionProviderProps) {
  const value = useMemo<EntityInteractionValue>(
    () => ({ inspectedEntityId, inspect }),
    [inspectedEntityId, inspect],
  )

  return (
    <EntityInteractionContext.Provider value={value}>
      {children}
    </EntityInteractionContext.Provider>
  )
}

/** Returns null when the current host has no entity-inspection capability. */
export function useEntityInteraction(): EntityInteractionValue | null {
  return useContext(EntityInteractionContext)
}

export interface EntityActivationEvent {
  button: number
  defaultPrevented: boolean
  altKey: boolean
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
}

/** True only for the same-tab activation the host is allowed to intercept. */
export function isPlainEntityActivation(event: EntityActivationEvent): boolean {
  return event.button === 0
    && !event.defaultPrevented
    && !event.altKey
    && !event.ctrlKey
    && !event.metaKey
    && !event.shiftKey
}
