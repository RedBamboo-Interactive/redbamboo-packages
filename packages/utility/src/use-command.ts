import { useEffect, useRef } from "react"
import { useCommandStore } from "./command-provider"
import type { Command } from "./types"

type CommandOptions = Omit<Command, "id"> & { enabled?: boolean }

export function useCommand(id: string, options: CommandOptions) {
  const { enabled = true } = options
  const store = useCommandStore()
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
      group: options.group,
      icon: options.icon,
      shortcut: options.shortcut,
      keywords: options.keywords,
      action: () => ref.current.action(),
    })
    return () => store.unregister(id)
  }, [store, id, enabled, options.label, options.group, options.icon, options.shortcut])
}
