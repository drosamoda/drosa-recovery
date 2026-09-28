import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from 'recharts'
import { shortDay } from '../../lib/series'

// Biblioteca de gráficos da Central (Recharts). Cores sempre via tokens CSS.
// Animação JS do Recharts desligada: depende de requestAnimationFrame e congela
// no meio em abas em segundo plano; a entrada fica por conta do CSS (.enter).
export interface Series<K extends string = string> {
  key: K
  label: string
  color: string
}

const nf = (v: number) => v.toLocaleString('pt-BR')
const AXIS = { stroke: 'var(--chart-axis)', fontSize: 11, tickLine: false, axisLine: false } as const

export function ChartTooltip({ active, payload, label, labelFormatter }: TooltipProps<number, string> & { labelFormatter?: (l: string) => string }) {
  if (!active || !payload?.length) return null
  const total = payload.reduce((a, p) => a + (Number(p.value) || 0), 0)
  return (
    <div role="tooltip" className="rounded-md border px-3 py-2 text-xs shadow-pop" style={{ background: 'rgb(var(--c-overlay) / 0.96)', borderColor: 'var(--border-strong)', backdropFilter: 'blur(8px)' }}>
      {label !== undefined && <p className="mb-1 font-medium text-ink">{labelFormatter ? labelFormatter(String(label)) : String(label)}</p>}
      <ul className="space-y-0.5">
        {payload.map((p) => (
          <li key={String(p.dataKey)} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-1.5 text-ink-muted">
              <span className="h-2 w-2 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
              {p.name}
            </span>
            <span className="tabular-nums text-ink">{nf(Number(p.value) || 0)}</span>
          </li>
        ))}
      </ul>
      {payload.length > 1 && (
        <p className="mt-1 flex justify-between border-t pt-1 text-ink-muted" style={{ borderColor: 'var(--border-subtle)' }}>
          <span>Total</span>
          <span className="tabular-nums text-ink">{nf(total)}</span>
        </p>
      )}
    </div>
  )
}

function srSummary<T extends object>(data: T[], series: Series[], xKey: keyof T): string {
  const totals = series.map((s) => `${s.label}: ${nf(data.reduce((a, d) => a + (Number((d as Record<string, unknown>)[s.key]) || 0), 0))}`)
  return `${data.length} pontos (${String(xKey)}). Totais — ${totals.join('; ')}.`
}

export function TrendAreaChart<T extends object>({ data, series, xKey = 'day' as keyof T, height = 220, stacked = false, ariaLabel }: { data: T[]; series: Series[]; xKey?: keyof T; height?: number; stacked?: boolean; ariaLabel: string }) {
  return (
    <figure aria-label={ariaLabel} className="m-0">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
            <defs>
              {series.map((s) => (
                <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={s.color} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey as string} tickFormatter={shortDay} minTickGap={24} {...AXIS} />
            <YAxis allowDecimals={false} width={48} {...AXIS} />
            <Tooltip content={<ChartTooltip labelFormatter={shortDay} />} cursor={{ stroke: 'var(--border-strong)' }} />
            {series.map((s) => (
              <Area key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} fill={`url(#grad-${s.key})`} stackId={stacked ? 'a' : undefined} isAnimationActive={false} />
            ))}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{srSummary(data, series, xKey)}</figcaption>
    </figure>
  )
}

export function MultiLineChart<T extends object>({ data, series, xKey = 'day' as keyof T, height = 220, ariaLabel }: { data: T[]; series: Series[]; xKey?: keyof T; height?: number; ariaLabel: string }) {
  return (
    <figure aria-label={ariaLabel} className="m-0">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey as string} tickFormatter={shortDay} minTickGap={24} {...AXIS} />
            <YAxis allowDecimals={false} width={48} {...AXIS} />
            <Tooltip content={<ChartTooltip labelFormatter={shortDay} />} cursor={{ stroke: 'var(--border-strong)' }} />
            {series.map((s) => (
              <Line key={s.key} type="monotone" dataKey={s.key} name={s.label} stroke={s.color} strokeWidth={2} dot={false} activeDot={{ r: 3 }} isAnimationActive={false} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{srSummary(data, series, xKey)}</figcaption>
    </figure>
  )
}

export function StackedBarChart<T extends object>({ data, series, xKey = 'day' as keyof T, height = 220, ariaLabel, onBarClick }: { data: T[]; series: Series[]; xKey?: keyof T; height?: number; ariaLabel: string; onBarClick?: (seriesKey: string) => void }) {
  return (
    <figure aria-label={ariaLabel} className="m-0">
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 6, left: -18, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis dataKey={xKey as string} tickFormatter={shortDay} minTickGap={16} {...AXIS} />
            <YAxis allowDecimals={false} width={48} {...AXIS} />
            <Tooltip content={<ChartTooltip labelFormatter={shortDay} />} cursor={{ fill: 'rgb(255 255 255 / 0.04)' }} />
            {series.map((s, i) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.label}
                stackId="a"
                fill={s.color}
                radius={i === series.length - 1 ? [3, 3, 0, 0] : 0}
                isAnimationActive={false}
                cursor={onBarClick ? 'pointer' : undefined}
                onClick={onBarClick ? () => onBarClick(s.key) : undefined}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="sr-only">{srSummary(data, series, xKey)}</figcaption>
    </figure>
  )
}

export interface BarDatum {
  label: string
  value: number
  color?: string
  hint?: string
}

/** Barras horizontais em HTML/CSS (leve, legível em mobile, texto selecionável). */
export function HorizontalBarChart({ data, ariaLabel, formatValue = nf, onSelect }: { data: BarDatum[]; ariaLabel: string; formatValue?: (v: number) => string; onSelect?: (d: BarDatum) => void }) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul aria-label={ariaLabel} className="space-y-2.5">
      {data.map((d) => {
        const inner = (
          <>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-ink-muted">{d.label}</span>
              <span className="shrink-0 tabular-nums text-ink">{formatValue(d.value)}{d.hint && <span className="ml-1.5 text-ink-faint">{d.hint}</span>}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full" style={{ background: 'rgb(255 255 255 / 0.05)' }}>
              <div className="h-full rounded-full transition-[width] duration-700 ease-out" style={{ width: `${(d.value / max) * 100}%`, background: d.color ?? 'var(--chart-1)' }} />
            </div>
          </>
        )
        return (
          <li key={d.label}>
            {onSelect ? (
              <button type="button" onClick={() => onSelect(d)} className="block w-full rounded-md text-left hover:opacity-90">
                {inner}
              </button>
            ) : (
              inner
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function DonutChart({ data, ariaLabel, centerLabel, centerValue, size = 168 }: { data: BarDatum[]; ariaLabel: string; centerLabel?: string; centerValue?: string; size?: number }) {
  const total = data.reduce((a, d) => a + d.value, 0)
  return (
    <figure aria-label={ariaLabel} className="relative m-0 mx-auto" style={{ width: size, height: size }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie data={total > 0 ? data : [{ label: 'vazio', value: 1 }]} dataKey="value" nameKey="label" innerRadius="70%" outerRadius="100%" paddingAngle={total > 0 ? 2 : 0} stroke="none" isAnimationActive={false}>
            {(total > 0 ? data : [{ label: 'vazio', value: 1 }]).map((d) => (
              <Cell key={d.label} fill={total > 0 ? (d as BarDatum).color ?? 'var(--chart-1)' : 'rgb(255 255 255 / 0.06)'} />
            ))}
          </Pie>
          {total > 0 && <Tooltip content={<ChartTooltip />} />}
        </PieChart>
      </ResponsiveContainer>
      {(centerLabel || centerValue) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          {centerValue && <span className="t-metric text-xl">{centerValue}</span>}
          {centerLabel && <span className="text-[11px] text-ink-faint">{centerLabel}</span>}
        </div>
      )}
      <figcaption className="sr-only">{data.map((d) => `${d.label}: ${nf(d.value)}`).join('; ')}</figcaption>
    </figure>
  )
}

/** Sparkline sem eixos — só forma da série, para KPI cards. */
export function MiniSparkline({ values, color = 'var(--chart-1)', height = 32 }: { values: number[]; color?: string; height?: number }) {
  if (values.length < 2 || values.every((v) => v === 0)) return null
  const data = values.map((v, i) => ({ i, v }))
  const id = `spark-${Math.abs(values.reduce((a, v, i) => a + v * (i + 1), 0)) % 100000}-${values.length}`
  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 2 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area type="monotone" dataKey="v" stroke={color} strokeWidth={1.5} fill={`url(#${id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
