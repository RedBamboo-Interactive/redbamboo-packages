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

const warnedCollisions = new Set<string>()

function warnOnce(key: string, message: string) {
  if (warnedCollisions.has(key)) return
  warnedCollisions.add(key)
  console.warn(`[command-palette] ${message}`)
}

/**
 * Machine-discoverable mirror of the command list. AI agents (Nova, browser drivers)
 * can enumerate available UI actions via `window.__redbamboo_commands` and invoke one
 * via `window.__redbamboo_runCommand(id)`.
 */
function syncWindowMirror(snapshot: Command[]) {
  if (typeof window === "undefined") return
  const w = window as unknown as Record<string, unknown>
  w.__redbamboo_commands = snapshot.map((c) => ({
    id: c.id,
    label: c.label,
    description: c.description,
    group: c.group,
    shortcut: c.shortcut,
    keywords: c.keywords,
  }))
}

function createCommandStore(): CommandStore {
  let commands = new Map<string, Command>()
  let snapshot: Command[] = []
  const listeners = new Set<() => void>()

  function notify() {
    snapshot = Array.from(commands.values())
    syncWindowMirror(snapshot)
    for (const fn of listeners) fn()
  }

  function checkCollisions(command: Command) {
    // DOM-discovered commands legitimately re-register on every scan
    if (command.id.startsWith(DOM_PREFIX)) return

    if (commands.has(command.id)) {
      warnOnce(`id:${command.id}`,
        `Command id "${command.id}" registered twice — the previous registration is silently replaced. ` +
        "Check for duplicate useCommand calls (e.g. AppShell + useAskNovaCommand both registering ask-nova).")
    }

    if (command.shortcut) {
      const parsed = parseShortcut(command.shortcut)
      if (parsed) {
        for (const other of commands.values()) {
          if (other.id === command.id || !other.shortcut) continue
          const otherParsed = parseShortcut(other.shortcut)
          if (otherParsed && sameShortcut(parsed, otherParsed)) {
            warnOnce(`shortcut:${command.id}:${other.id}`,
              `Shortcut conflict: "${command.shortcut}" is bound by both "${other.id}" and "${command.id}". ` +
              "The first registered command wins; the second will never fire from the keyboard.")
          }
        }
      }
    }
  }

  return {
    register(command) {
      checkCollisions(command)
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
      description: el.getAttribute("data-command-description") ?? undefined,
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

// ── Global shortcut listener ─────────────────────────────────────────

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

interface ParsedShortcut {
  key: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

function parseShortcut(shortcut: string): ParsedShortcut | null {
  const s = shortcut.trim()
  if (!s) return null

  let ctrl = false
  let meta = false
  let alt = false
  let shift = false
  let key: string

  if (s.includes("⌘")) {
    meta = true
    key = s.replace("⌘", "")
  } else if (s.includes("+")) {
    const parts = s.split("+")
    key = parts[parts.length - 1]
    for (let i = 0; i < parts.length - 1; i++) {
      const mod = parts[i].trim().toLowerCase()
      if (mod === "ctrl") ctrl = true
      else if (mod === "meta" || mod === "cmd") meta = true
      else if (mod === "alt") alt = true
      else if (mod === "shift") shift = true
    }
  } else {
    key = s
  }

  if (!key) return null
  return { key, ctrl, meta, alt, shift }
}

function sameShortcut(a: ParsedShortcut, b: ParsedShortcut): boolean {
  return a.key.toLowerCase() === b.key.toLowerCase()
    && a.ctrl === b.ctrl && a.meta === b.meta && a.alt === b.alt && a.shift === b.shift
}

function matchesEvent(e: KeyboardEvent, p: ParsedShortcut): boolean {
  if (e.key !== p.key && e.key.toLowerCase() !== p.key.toLowerCase()) return false

  const expectCtrl = p.ctrl || (!isMac && p.meta)
  const expectMeta = isMac && p.meta

  if (e.ctrlKey !== expectCtrl) return false
  if (e.metaKey !== expectMeta) return false
  if (e.altKey !== p.alt) return false
  if (e.shiftKey !== p.shift) return false

  return true
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

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement
      const isInput = target.tagName === "INPUT"
        || target.tagName === "TEXTAREA"
        || target.isContentEditable
      const isFnKey = /^F\d{1,2}$/.test(e.key)
      const hasModifier = e.ctrlKey || e.metaKey || e.altKey

      if (isInput && !isFnKey && !hasModifier) return

      for (const cmd of store.getSnapshot()) {
        if (!cmd.shortcut) continue
        const parsed = parseShortcut(cmd.shortcut)
        if (!parsed) continue
        if (matchesEvent(e, parsed)) {
          e.preventDefault()
          cmd.action()
          return
        }
      }
    }

    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [store])

  // Machine-facing invoke hook, paired with the window.__redbamboo_commands list
  useEffect(() => {
    const w = window as unknown as Record<string, unknown>
    w.__redbamboo_runCommand = (id: string): boolean => {
      const cmd = store.getSnapshot().find((c) => c.id === id)
      if (!cmd) return false
      cmd.action()
      return true
    }
    return () => {
      delete w.__redbamboo_runCommand
    }
  }, [store])

  return (
    <CommandStoreContext.Provider value={store}>
      {children}
    </CommandStoreContext.Provider>
  )
}
