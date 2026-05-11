import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type ReactNode,
} from "react"
import type { Command } from "./types"

interface CommandStore {
  register(command: Command): void
  unregister(id: string): void
  subscribe(callback: () => void): () => void
  getSnapshot(): Command[]
}

function createCommandStore(): CommandStore {
  let commands = new Map<string, Command>()
  let snapshot: Command[] = []
  const listeners = new Set<() => void>()

  function notify() {
    snapshot = Array.from(commands.values())
    for (const fn of listeners) fn()
  }

  return {
    register(command) {
      commands = new Map(commands)
      commands.set(command.id, command)
      notify()
    },
    unregister(id) {
      if (!commands.has(id)) return
      commands = new Map(commands)
      commands.delete(id)
      notify()
    },
    subscribe(callback) {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
    getSnapshot() {
      return snapshot
    },
  }
}

const CommandStoreContext = createContext<CommandStore | null>(null)

export function useCommandStore(): CommandStore {
  const store = useContext(CommandStoreContext)
  if (!store) throw new Error("useCommandStore must be used within a CommandProvider")
  return store
}

export function useCommandList(): Command[] {
  const store = useCommandStore()
  return useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
}

// ── DOM auto-discovery ────────────────────────────────────────────────

const DOM_PREFIX = "__dom:"

function scanDOM(store: CommandStore) {
  const seen = new Set<string>()
  const elements = document.querySelectorAll<HTMLElement>("[data-command]")

  for (const el of elements) {
    if (el.closest("[data-slot='command-palette']")) continue
    const label = el.getAttribute("data-command")
    if (!label) continue

    const id = `${DOM_PREFIX}${label}`
    seen.add(id)

    const keywords = el.getAttribute("data-command-keywords")
    store.register({
      id,
      label,
      group: el.getAttribute("data-command-group") ?? undefined,
      shortcut: el.getAttribute("data-command-shortcut") ?? undefined,
      keywords: keywords ? keywords.split(",").map((k) => k.trim()) : undefined,
      action: () => el.click(),
    })
  }

  for (const cmd of store.getSnapshot()) {
    if (cmd.id.startsWith(DOM_PREFIX) && !seen.has(cmd.id)) {
      store.unregister(cmd.id)
    }
  }
}

// ── Provider ──────────────────────────────────────────────────────────

export interface CommandProviderProps {
  children: ReactNode
  /** Scan the DOM for elements with `data-command` attributes. Default `true`. */
  discover?: boolean
}

export function CommandProvider({ children, discover = true }: CommandProviderProps) {
  const storeRef = useRef<CommandStore | null>(null)
  if (!storeRef.current) storeRef.current = createCommandStore()
  const store = storeRef.current

  useEffect(() => {
    if (!discover) return

    scanDOM(store)

    let timeout: ReturnType<typeof setTimeout>
    const observer = new MutationObserver(() => {
      clearTimeout(timeout)
      timeout = setTimeout(() => scanDOM(store), 100)
    })

    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-command"],
    })

    return () => {
      observer.disconnect()
      clearTimeout(timeout)
    }
  }, [store, discover])

  return (
    <CommandStoreContext.Provider value={store}>
      {children}
    </CommandStoreContext.Provider>
  )
}
