import { useState, useEffect, useRef, useCallback } from "react"
import { Badge, Button, Input, cn } from "@redbamboo/ui"
import type { LogEntry, LogLevel } from "./log-types"
import { LOG_LEVELS, LOG_LEVEL_COLORS, LOG_LEVEL_SEVERITY } from "./log-types"

export interface LogPanelProps {
  entries: LogEntry[]
  connected?: boolean
  paused?: boolean
  onPauseChange?: (paused: boolean) => void
  onClear?: () => void
  onRefresh?: () => void
  errorCount?: number
  warnCount?: number
  className?: string
}

export function LogPanel({
  entries,
  connected,
  paused = false,
  onPauseChange,
  onClear,
  onRefresh,
  errorCount = 0,
  warnCount = 0,
  className,
}: LogPanelProps) {
  const [search, setSearch] = useState("")
  const [levelFilter, setLevelFilter] = useState<LogLevel | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const filtered = entries.filter(entry => {
    if (levelFilter && LOG_LEVEL_SEVERITY[entry.level] < LOG_LEVEL_SEVERITY[levelFilter])
      return false
    if (categoryFilter && !(entry.category ?? "").startsWith(categoryFilter))
      return false
    if (search) {
      const q = search.toLowerCase()
      return (
        entry.message.toLowerCase().includes(q) ||
        entry.tag?.toLowerCase().includes(q) ||
        (entry.category ?? "").toLowerCase().includes(q)
      )
    }
    return true
  })

  const categories = Array.from(new Set(entries.map(e => (e.category ?? "").split(".")[0]).filter(Boolean))).sort()

  useEffect(() => {
    if (!autoScrollRef.current || paused) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [filtered.length, paused])

  const onScroll = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    autoScrollRef.current = atBottom
  }, [])

  const toggleLevel = useCallback((level: LogLevel) => {
    setLevelFilter(prev => prev === level ? null : level)
  }, [])

  return (
    <div data-slot="log-panel" className={cn("flex flex-col h-full", className)}>
      <div data-slot="log-panel-toolbar" className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0 flex-wrap">
        <div className="flex items-center gap-1">
          {connected !== undefined && (
            <span
              className="inline-block w-2 h-2 rounded-full shrink-0"
              style={{ backgroundColor: connected ? "#43A25A" : "#727680" }}
              title={connected ? "Connected" : "Disconnected"}
            />
          )}
          {LOG_LEVELS.filter(l => l !== "debug").map(level => (
            <button
              key={level}
              className={cn(
                "px-1.5 py-0.5 rounded text-[10px] font-medium uppercase transition-colors cursor-pointer",
                levelFilter === level
                  ? "ring-1 ring-offset-1 ring-offset-background"
                  : "opacity-60 hover:opacity-100",
              )}
              style={{
                color: LOG_LEVEL_COLORS[level],
                ...(levelFilter === level ? { ringColor: LOG_LEVEL_COLORS[level] } : {}),
              }}
              onClick={() => toggleLevel(level)}
            >
              {level}
              {level === "error" && errorCount > 0 && ` (${errorCount})`}
              {level === "warn" && warnCount > 0 && ` (${warnCount})`}
            </button>
          ))}
        </div>

        <Input
          className="h-6 text-xs flex-1 min-w-[120px]"
          placeholder="Search logs..."
          value={search}
          onChange={e => setSearch(e.target.value)}
        />

        {categories.length > 1 && (
          <select
            className="h-6 text-xs bg-transparent border border-border rounded px-1 text-foreground"
            value={categoryFilter ?? ""}
            onChange={e => setCategoryFilter(e.target.value || null)}
          >
            <option value="">All categories</option>
            {categories.map(cat => (
              <option key={cat} value={cat}>{cat}</option>
            ))}
          </select>
        )}

        <div className="flex items-center gap-1 ml-auto">
          {onPauseChange && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={() => onPauseChange(!paused)}>
              {paused ? "Resume" : "Pause"}
            </Button>
          )}
          {onRefresh && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onRefresh}>
              Refresh
            </Button>
          )}
          {onClear && (
            <Button variant="ghost" size="sm" className="h-6 text-xs px-2" onClick={onClear}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="flex-1 overflow-auto"
      >
        <div data-slot="log-panel-entries" className="font-mono text-xs">
          {filtered.length === 0 && (
            <div className="px-3 py-8 text-center text-text-muted text-xs">
              {entries.length === 0 ? "No log entries" : "No matching entries"}
            </div>
          )}
          {filtered.map(entry => (
            <LogEntryRow key={entry.id} entry={entry} />
          ))}
        </div>
      </div>
    </div>
  )
}

function LogEntryRow({ entry }: { entry: LogEntry }) {
  const [expanded, setExpanded] = useState(false)
  const hasDetails = entry.full_message || entry.stack_trace || entry.metadata
  const ts = formatTimestamp(entry.timestamp)

  return (
    <div data-slot="log-entry">
      <div
        className={cn(
          "flex items-start gap-2 px-3 py-1 hover:bg-muted/50 transition-colors border-b border-border/30",
          hasDetails && "cursor-pointer",
          entry.is_error && "bg-destructive/5",
        )}
        onClick={hasDetails ? () => setExpanded(prev => !prev) : undefined}
      >
        <span className="text-text-muted shrink-0 w-[72px]">{ts}</span>
        <span
          className="shrink-0 w-[52px] uppercase font-semibold text-[10px] leading-4"
          style={{ color: LOG_LEVEL_COLORS[entry.level] }}
        >
          {entry.level}
        </span>
        {entry.tag && (
          <Badge
            variant="outline"
            className="shrink-0 text-[10px] px-1 py-0 h-4 leading-4"
            style={entry.tag_color ? { borderColor: entry.tag_color, color: entry.tag_color } : undefined}
          >
            {entry.tag}
          </Badge>
        )}
        {entry.category && <span className="text-text-muted shrink-0">{entry.category}</span>}
        <span className="truncate flex-1">{entry.message}</span>
        {hasDetails && (
          <span className="text-text-muted shrink-0 text-[10px]">{expanded ? "−" : "+"}</span>
        )}
      </div>
      {expanded && (
        <div className="px-3 py-2 ml-[76px] space-y-1 bg-muted/30 border-b border-border/30">
          {entry.full_message && (
            <pre className="text-xs whitespace-pre-wrap text-foreground/80">{entry.full_message}</pre>
          )}
          {entry.stack_trace && (
            <pre className="text-xs whitespace-pre-wrap text-destructive/70">{entry.stack_trace}</pre>
          )}
          {entry.metadata && (
            <pre className="text-xs whitespace-pre-wrap text-text-muted">
              {JSON.stringify(entry.metadata, null, 2)}
            </pre>
          )}
          <div className="flex gap-3 text-[10px] text-text-muted pt-1">
            {entry.correlation_id && <span>correlation: {entry.correlation_id}</span>}
            {entry.job_id && <span>job: {entry.job_id}</span>}
            {entry.instance_id && <span>instance: {entry.instance_id}</span>}
            <span>id: {entry.id}</span>
          </div>
        </div>
      )}
    </div>
  )
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso)
  const h = d.getHours().toString().padStart(2, "0")
  const m = d.getMinutes().toString().padStart(2, "0")
  const s = d.getSeconds().toString().padStart(2, "0")
  const ms = d.getMilliseconds().toString().padStart(3, "0")
  return `${h}:${m}:${s}.${ms}`
}
