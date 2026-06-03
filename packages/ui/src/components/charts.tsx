import type { ReactNode } from "react"
import {
  ResponsiveContainer, BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip,
} from "recharts"

const GRID_COLOR = "rgba(255,255,255,0.06)"
const AXIS_COLOR = "#9B9CA2"

export const CHART_PALETTE = [
  "#D4AA4F", "#7C4DFF", "#26A69A", "#E55B5B", "#42A5F5",
  "#AB47BC", "#FF7043", "#66BB6A", "#EC407A", "#8D6E63",
]

// --- ChartCard ---

interface ChartCardProps {
  title: string
  children: ReactNode
  className?: string
}

export function ChartCard({ title, children, className }: ChartCardProps) {
  return (
    <div data-slot="chart-card" className={`bg-surface-elevated rounded-xl shadow-[0_1px_6px_rgba(0,0,0,0.15)] p-5 ${className || ""}`}>
      <h3 className="text-[13px] font-medium text-contrast mb-4">{title}</h3>
      {children}
    </div>
  )
}

// --- ChartTooltip ---

interface ChartTooltipProps {
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
  formatValue?: (value: number, name: string) => string
}

export function ChartTooltip({ payload, label, formatValue }: ChartTooltipProps) {
  if (!payload?.length) return null
  return (
    <div className="bg-[#2E3038] border border-[#43454F] rounded-lg px-3 py-2 text-xs shadow-lg">
      {label && <div className="text-text-muted mb-1">{label}</div>}
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
          <span className="text-contrast">
            {entry.name}:{" "}
            <span className="font-mono">
              {formatValue ? formatValue(entry.value, entry.name) : entry.value}
            </span>
          </span>
        </div>
      ))}
    </div>
  )
}

// --- Empty state ---

function EmptyState({ height, message }: { height: number; message: string }) {
  return (
    <div className="flex items-center justify-center text-text-disabled text-xs" style={{ height }}>
      {message}
    </div>
  )
}

// --- RbBarChart ---

export interface BarChartSeries {
  dataKey: string
  name: string
  color: string
}

interface RbBarChartProps {
  data: Record<string, any>[]
  xKey: string
  series: BarChartSeries[]
  stacked?: boolean
  height?: number
  emptyMessage?: string
  formatTooltip?: (value: number, name: string) => string
}

function isBarDataEmpty(data: Record<string, any>[], series: BarChartSeries[]): boolean {
  if (data.length === 0) return true
  return data.every(row =>
    series.every(s => {
      const v = row[s.dataKey]
      return v === 0 || v == null
    })
  )
}

export function RbBarChart({ data, xKey, series, stacked, height = 220, emptyMessage = "No data", formatTooltip }: RbBarChartProps) {
  if (isBarDataEmpty(data, series)) return <EmptyState height={height} message={emptyMessage} />

  const stackId = stacked ? "a" : undefined

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} barCategoryGap="20%">
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: AXIS_COLOR, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis tick={{ fill: AXIS_COLOR, fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} width={30} />
        <RechartsTooltip content={<ChartTooltip formatValue={formatTooltip} />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        {series.map((s, i) => (
          <Bar
            key={s.dataKey}
            dataKey={s.dataKey}
            name={s.name}
            fill={s.color}
            stackId={stackId}
            radius={stacked && i === series.length - 1 ? [2, 2, 0, 0] : [0, 0, 0, 0]}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

// --- RbAreaChart ---

export interface AreaChartSeries {
  dataKey: string
  color: string
  name?: string
}

interface RbAreaChartProps {
  data: Record<string, any>[]
  xKey: string
  series: AreaChartSeries[]
  height?: number
  formatY?: (value: number) => string
  formatTooltip?: (value: number, name: string) => string
  emptyMessage?: string
}

function isAreaDataEmpty(data: Record<string, any>[], series: AreaChartSeries[]): boolean {
  if (data.length === 0) return true
  return data.every(row =>
    series.every(s => {
      const v = row[s.dataKey]
      return v === 0 || v == null
    })
  )
}

export function RbAreaChart({ data, xKey, series, height = 220, formatY, formatTooltip, emptyMessage = "No data" }: RbAreaChartProps) {
  if (isAreaDataEmpty(data, series)) return <EmptyState height={height} message={emptyMessage} />

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data}>
        <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey={xKey} tick={{ fill: AXIS_COLOR, fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
        <YAxis
          tick={{ fill: AXIS_COLOR, fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          width={45}
          tickFormatter={formatY}
        />
        <RechartsTooltip content={<ChartTooltip formatValue={formatTooltip} />} cursor={{ stroke: "rgba(255,255,255,0.1)" }} />
        {series.map(s => (
          <Area
            key={s.dataKey}
            type="monotone"
            dataKey={s.dataKey}
            name={s.name}
            stroke={s.color}
            fill={s.color}
            fillOpacity={0.15}
            strokeWidth={2}
            dot={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

// --- RbDonutChart ---

export interface DonutSegment {
  name: string
  value: number
  color?: string
}

interface RbDonutChartProps {
  data: DonutSegment[]
  height?: number
  centerLabel?: string | number
  colors?: string[]
  emptyMessage?: string
  showLegend?: boolean
  formatTooltip?: (value: number, name: string) => string
}

function getSegmentColor(segment: DonutSegment, index: number, fallbackColors?: string[]): string {
  if (segment.color) return segment.color
  const palette = fallbackColors || CHART_PALETTE
  return palette[index % palette.length]!
}

export function RbDonutChart({ data, height = 220, centerLabel, colors, emptyMessage = "No data", showLegend, formatTooltip }: RbDonutChartProps) {
  const hasData = data.length > 0 && data.some(d => d.value > 0)

  if (!hasData) return <EmptyState height={height} message={emptyMessage} />

  return (
    <>
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={85}
            paddingAngle={2}
            strokeWidth={0}
          >
            {data.map((segment, i) => (
              <Cell key={i} fill={getSegmentColor(segment, i, colors)} />
            ))}
          </Pie>
          <RechartsTooltip content={<ChartTooltip formatValue={formatTooltip} />} />
          {centerLabel != null && (
            <text
              x="50%"
              y="50%"
              textAnchor="middle"
              dominantBaseline="central"
              style={{
                fill: "#D0D1D6",
                fontSize: typeof centerLabel === "number" ? 20 : 16,
                fontWeight: 600,
                fontFamily: "var(--font-mono)",
              }}
            >
              {centerLabel}
            </text>
          )}
        </PieChart>
      </ResponsiveContainer>
      {showLegend && (
        <div className="flex flex-wrap gap-3 mt-1">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center gap-1.5 text-[10px]">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: getSegmentColor(d, i, colors) }} />
              <span className="text-text-muted">{d.name}</span>
              <span className="font-mono text-text-disabled">{d.value}</span>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
