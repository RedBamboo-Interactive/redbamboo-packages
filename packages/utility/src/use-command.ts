import { useEffect, useRef } from "react"
import { useCommandSource, useCommandStore } from "./command-provider"
import type { Command } from "./types"

type CommandOptions = Omit<Command, "id"> & { enabled?: boolean }

export function useCommand(id: string, options: CommandOptions) {
  const { enabled = true } = options
  const store = useCommandStore()
  const inheritedSource = useCommandSource()
  const source = options.source ?? inheritedSource
  const ref = useRef(options)
  ref.current = options

  useEffect(() => {
    if (!enabled) {
      store.unregister(id)
      return
    }
    store.register({
      id,
      label: options.label,
      description: options.description,
      source,
      group: options.group,
      icon: options.icon,
      shortcut: options.shortcut,
      keywords: options.keywords,
      requiresUserActivation: options.requiresUserActivation,
      targetSurfaceId: options.targetSurfaceId,
      action: () => ref.current.action(),
    })
    return () => store.unregister(id)
  }, [
    store,
    id,
    enabled,
    options.label,
    options.description,
    options.group,
    options.icon,
    options.shortcut,
    options.requiresUserActivation,
    options.targetSurfaceId,
    source?.id,
    source?.label,
    source?.icon,
    source?.color,
  ])
}
