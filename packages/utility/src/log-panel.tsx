import { useState, useEffect, useRef, useCallback, useMemo } from "react"
import { FilterBar, FilterPillGroup, cn } from "@redbamboo/ui"
import type { LogEntry, LogLevel } from "./log-types"
import { LOG_LEVELS, LOG_LEVEL_COLORS, LOG_LEVEL_SEVERITY } from "./log-types"

function entrySource(entry: LogEntry): string {
  return entry.tag || entry.category || entry.source || ""
}

function entryLevel(entry: LogEntry): LogLevel {
  return entry.level || "info"
}

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
  onClear,
  className,
}: LogPanelProps) {
  const [search, setSearch] = useState("")
  const [levelFilter, setLevelFilter] = useState<string | null>(null)
  const [sourceFilter, setSourceFilter] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const autoScrollRef = useRef(true)

  const levelCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of entries) {
      const l = entryLevel(e)
      counts[l] = (counts[l] || 0) + 1
    }
    return counts
  }, [entries])

  const levelOptions = useMemo(
    () => LOG_LEVELS.filter(l => l !== "debug").map(l => ({
      value: l,
      count: levelCounts[l] || 0,
      color: LOG_LEVEL_COLORS[l],
    })),
    [levelCounts],
  )

  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const e of entries) {
      const s = entrySource(e).split(".")[0]
      if (s) counts[s] = (counts[s] || 0) + 1
    }
    return counts
  }, [entries])

  const sourceOptions = useMemo(
    () => Object.keys(sourceCounts).sort().map(s => ({
      value: s,
      count: sourceCounts[s],
    })),
    [sourceCounts],
  )

  const filtered = useMemo(() => entries.filter(entry => {
    const level = entryLevel(entry)
    if (levelFilter && LOG_LEVEL_SEVERITY[level] < LOG_LEVEL_SEVERITY[levelFilter as LogLevel])
      return false
    const source = entrySource(entry)
    if (sourceFilter && !source.startsWith(sourceFilter))
      return false
    if (search) {
      const q = search.toLowerCase()
      return (
        entry.message.toLowerCase().includes(q) ||
        source.toLowerCase().includes(q)
      )
    }
    return true
  }), [entries, levelFilter, sourceFilter, search])

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

  const hasFilters = !!(levelFilter || sourceFilter || search)

  return (
    <div data-slot="log-panel" className={cn("flex flex-col h-full", className)}>
      <div className="flex items-center h-12 px-3 border-b border-overlay-6 shrink-0">
        {connected !== undefined && (
          <span
            className="inline-block w-1.5 h-1.5 rounded-full shrink-0 mr-2"
            style={{ backgroundColor: connected ? "#26A69A" : "#6B6F77" }}
            title={connected ? "Connected" : "Disconnected"}
          />
        )}
        <span className="text-[14px] font-medium text-contrast flex-1">Console</span>
        {onClear && (
          <button
            className="text-text-muted hover:text-contrast transition-colors cursor-pointer p-1"
            onClick={onClear}
            title="Clear logs"
          >
            <i className="fa-solid fa-trash-can text-xs" />
          </button>
        )}
      </div>

      <FilterBar
        search={search}
        onSearch={setSearch}
        placeholder="Search logs..."
        summary={hasFilters ? `${filtered.length} of ${entries.length} entries` : undefined}
        className="py-2"
      >
        <FilterPillGroup
          label="Level"
          icon="fa-solid fa-layer-group"
          options={levelOptions}
          value={levelFilter}
          onChange={setLevelFilter}
        />
        <FilterPillGroup
          label="Source"
          icon="fa-solid fa-tag"
          options={sourceOptions}
          value={sourceFilter}
          onChange={setSourceFilter}
          activeColor="rgba(212,170,79,0.2)"
          activeTextColor="#D4AA4F"
        />
      </FilterBar>

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
  const ts = formatTimestamp(entry.timestamp)
  const level = entryLevel(entry)
  const source = entrySource(entry)

  return (
    <div data-slot="log-entry">
      <div
        className={cn(
          "grid items-center gap-x-3 px-3 py-1 hover:bg-overlay-4 transition-colors border-b border-overlay-6 cursor-pointer",
          entry.is_error && "bg-destructive/5",
        )}
        style={{ gridTemplateColumns: "92px 20px 80px 1fr" }}
        onClick={() => setExpanded(prev => !prev)}
      >
        <span className="text-text-muted">{ts}</span>
        <span
          className="w-2.5 h-2.5 rounded-[2px] justify-self-center"
          style={{ backgroundColor: LOG_LEVEL_COLORS[level] }}
          title={level}
        />
        <span
          className="truncate text-text-muted"
          style={entry.tag_color ? { color: entry.tag_color } : undefined}
          title={source}
        >
          {source}
        </span>
        <span className="truncate">{entry.message}</span>
      </div>
      {expanded && (
        <div className="py-2 pr-3 space-y-1 bg-muted/30 border-b border-overlay-6" style={{ paddingLeft: "calc(192px + 3rem)" }}>
          <pre className="text-xs whitespace-pre-wrap text-foreground/80">
            {entry.full_message || entry.message}
          </pre>
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
