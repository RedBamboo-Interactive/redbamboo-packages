import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  type KeyboardEvent,
} from "react"
import {
  cn,
  Badge,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@redbamboo/ui"
import { useCommandList } from "./command-provider"
import type { Command, CommandPaletteProps } from "./types"

// ── Fuzzy matching ────────────────────────────────────────────────────

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  let qi = 0
  let score = 0
  let consecutive = 0

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      consecutive++
      score += consecutive
      if (ti === 0 || " -_/".includes(t[ti - 1])) score += 5
      qi++
    } else {
      consecutive = 0
    }
  }

  return qi === q.length ? score : -1
}

function matchCommand(query: string, cmd: Command): number {
  if (!query) return 0

  const labelScore = fuzzyScore(query, cmd.label)
  if (labelScore > 0) return labelScore * 2

  if (cmd.group) {
    const groupScore = fuzzyScore(query, cmd.group)
    if (groupScore > 0) return groupScore
  }

  if (cmd.keywords) {
    let best = -1
    for (const kw of cmd.keywords) {
      const s = fuzzyScore(query, kw)
      if (s > best) best = s
    }
    if (best > 0) return best
  }

  return -1
}

const isMac =
  typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent)

// ── Component ─────────────────────────────────────────────────────────

export function CommandPalette({
  open: controlledOpen,
  onOpenChange,
  placeholder = "Search commands…",
}: CommandPaletteProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = useCallback(
    (value: boolean) => {
      if (!isControlled) setInternalOpen(value)
      onOpenChange?.(value)
    },
    [isControlled, onOpenChange],
  )

  const [query, setQuery] = useState("")
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const commands = useCommandList()

  const filtered = useMemo(() => {
    if (!query) return commands
    return commands
      .map((cmd) => ({ cmd, score: matchCommand(query, cmd) }))
      .filter((r) => r.score >= 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.cmd)
  }, [commands, query])

  const grouped = useMemo(() => {
    const map = new Map<string, Command[]>()
    for (const cmd of filtered) {
      const g = cmd.group ?? ""
      const arr = map.get(g)
      if (arr) arr.push(cmd)
      else map.set(g, [cmd])
    }
    return map
  }, [filtered])

  const flat = useMemo(() => {
    const out: Command[] = []
    for (const cmds of grouped.values()) out.push(...cmds)
    return out
  }, [grouped])

  const selectedCommand = flat[selectedIndex] ?? null

  // Ctrl+K / Cmd+K  +  imperative event trigger
  useEffect(() => {
    if (isControlled) return
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(true)
      }
    }
    function onCustom() {
      setOpen(true)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("command-palette:open", onCustom)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("command-palette:open", onCustom)
    }
  }, [isControlled, setOpen])

  useEffect(() => {
    if (open) {
      setQuery("")
      setSelectedIndex(0)
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open])

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, Math.max(0, flat.length - 1)))
  }, [flat.length])

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(
      "[data-selected='true']",
    )
    el?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  const execute = useCallback(
    (cmd: Command) => {
      setOpen(false)
      cmd.action()
    },
    [setOpen],
  )

  function onKeyDown(e: KeyboardEvent) {
    e.stopPropagation()
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedIndex((i) => Math.min(i + 1, flat.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedIndex((i) => Math.max(i - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        if (flat[selectedIndex]) execute(flat[selectedIndex])
        break
      case "Escape":
        e.preventDefault()
        setOpen(false)
        break
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        data-slot="command-palette"
        showCloseButton={false}
        className="sm:max-w-lg overflow-hidden"
        onKeyDown={onKeyDown}
      >
        {/* Header — matches About/Feedback pattern */}
        <DialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10">
              <i className="fa-solid fa-terminal text-lg text-primary" />
            </div>
            <div>
              <DialogTitle>Command Palette</DialogTitle>
              <DialogDescription>
                {flat.length} {flat.length === 1 ? "command" : "commands"} available
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        {/* Search input */}
        <div data-slot="command-palette-search">
          <div className="flex items-center gap-2.5 rounded-lg border border-input px-3 h-10 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30">
            <SearchIcon className="h-4 w-4 shrink-0 opacity-50" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded
              aria-controls="command-palette-listbox"
              aria-autocomplete="list"
              aria-activedescendant={flat[selectedIndex]?.id}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setSelectedIndex(0)
              }}
              placeholder={placeholder}
              className="flex-1 min-w-0 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
        </div>

        {/* Command list */}
        <div
          ref={listRef}
          id="command-palette-listbox"
          role="listbox"
          data-slot="command-palette-list"
          className="-mx-5 max-h-72 overflow-y-auto border-t border-foreground/10 p-2"
        >
          {flat.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No commands found.
            </p>
          )}

          {Array.from(grouped.entries()).map(([group, cmds]) => (
            <div key={group} data-slot="command-palette-group" role="group" aria-label={group || undefined}>
              {group && (
                <p className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">
                  {group}
                </p>
              )}
              {cmds.map((cmd) => {
                const index = flat.indexOf(cmd)
                const selected = index === selectedIndex
                const Icon = cmd.icon
                return (
                  <button
                    key={cmd.id}
                    id={cmd.id}
                    role="option"
                    aria-selected={selected}
                    data-slot="command-palette-item"
                    data-selected={selected || undefined}
                    className={cn(
                      "flex w-full cursor-pointer select-none items-center gap-2 rounded-lg px-3 py-2 text-sm outline-none",
                      selected && "bg-accent text-accent-foreground",
                    )}
                    onClick={() => execute(cmd)}
                    onMouseEnter={() => setSelectedIndex(index)}
                  >
                    {Icon && <Icon className="h-4 w-4 shrink-0 opacity-70" />}
                    <span className="flex-1 text-left">{cmd.label}</span>
                    {cmd.shortcut && (
                      <kbd className="ml-auto text-xs tracking-widest text-muted-foreground/60">
                        {cmd.shortcut}
                      </kbd>
                    )}
                  </button>
                )
              })}
            </div>
          ))}
        </div>

        {/* Footer — shows selected command info */}
        <DialogFooter className="-mx-5 -mb-5 mt-0">
          {selectedCommand ? (
            <div className="mr-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{selectedCommand.label}</span>
              {selectedCommand.group && (
                <Badge variant="secondary" className="text-[0.65rem]">
                  {selectedCommand.group}
                </Badge>
              )}
              {selectedCommand.shortcut && (
                <Badge variant="outline" className="text-[0.65rem]">
                  {selectedCommand.shortcut}
                </Badge>
              )}
            </div>
          ) : (
            <p className="mr-auto text-xs text-muted-foreground">
              {isMac ? "⌘K" : "Ctrl+K"} to toggle · ↑↓ navigate · Enter to run
            </p>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function openCommandPalette() {
  document.dispatchEvent(new Event("command-palette:open"))
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx={11} cy={11} r={8} />
      <path d="m21 21-4.3-4.3" />
    </svg>
  )
}
