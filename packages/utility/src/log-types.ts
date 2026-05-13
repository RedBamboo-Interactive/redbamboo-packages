export type LogLevel = "debug" | "info" | "warn" | "error" | "critical"

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  category: string
  source: string
  message: string
  full_message?: string | null
  tag?: string | null
  tag_color?: string | null
  stack_trace?: string | null
  correlation_id?: string | null
  job_id?: string | null
  instance_id?: string | null
  metadata?: Record<string, unknown> | null
  is_error: boolean
  is_multiline: boolean
}

export interface LogFilter {
  level?: LogLevel
  category?: string
  source?: string
  instance_id?: string
  correlation_id?: string
  job_id?: string
  search?: string
  after_id?: string
  since?: string
  until?: string
  limit?: number
}

export interface LogsResponse {
  entries: LogEntry[]
  total: number
  by_level: Record<string, number>
  error_count: number
  warn_count: number
}

export interface LogSummaryResponse {
  stats: {
    total: number
    errors: number
    warnings: number
    buffer_size: number
    buffer_capacity: number
    source: string
    has_persistence: boolean
    has_parser: boolean
  }
  recent_errors: LogEntry[]
}

export interface LogStreamEvent {
  type: "log.entry"
  data: LogEntry
}

export const LOG_LEVELS: LogLevel[] = ["debug", "info", "warn", "error", "critical"]

export const LOG_LEVEL_SEVERITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  critical: 4,
}

export const LOG_LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "#727680",
  info: "#4EA8DE",
  warn: "#FFB74D",
  error: "#FF5252",
  critical: "#D32F2F",
}
