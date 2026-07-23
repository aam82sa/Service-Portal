/**
 * Pure derivation layer for the analytics dashboard (Zone 1). One query-live
 * fetch returns every request created in TWICE the selected period (all under
 * the caller's own RLS); everything on screen — KPIs with deltas vs the
 * previous window, daily trend series, widget groupings, drill-down subsets —
 * is derived here, client-side, so filter changes never need a second fetch
 * shape and the maths is unit-testable without a network.
 */

import type { ReportConfig } from './api'

export interface RequestRow {
  ref: string
  title: string
  dept: string
  service_code: string
  service_name: string
  status: string
  priority: string
  created_at: string
  resolved_at: string | null
  updated_at: string
  sla_resolution_due: string | null
  sla_met: boolean
  breached: boolean
}

export const REQUEST_COLUMNS: (keyof RequestRow)[] = [
  'ref', 'title', 'dept', 'service_code', 'service_name', 'status', 'priority',
  'created_at', 'resolved_at', 'updated_at', 'sla_resolution_due', 'sla_met', 'breached',
]

export const OPEN_STATUSES = ['new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester', 'escalated']

export type PeriodKey = 'last7' | 'last30' | 'quarter' | 'ytd'
export type StatusKey = 'all' | 'open' | 'resolved' | 'closed'

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  quarter: 'Last quarter',
  ytd: 'Year to date',
}
export const STATUS_LABEL: Record<StatusKey, string> = {
  all: 'All', open: 'Open only', resolved: 'Resolved', closed: 'Closed',
}
export const DEPT_LABEL: Record<string, string> = {
  IT: 'IT', ADMIN: 'Administration', LOG: 'Logistics', ALL: 'All departments',
}
export const DEPT_FILL: Record<string, string> = {
  IT: 'var(--it)', ADMIN: 'var(--admin)', LOG: 'var(--log)',
}

export interface FilterState {
  dash: string
  period: PeriodKey
  dept: string // dept code or 'ALL'
  priority: string // 'P1'..'P4' or 'ALL'
  status: StatusKey
}

const DAY = 86_400_000

export function periodDays(key: PeriodKey, now: Date): number {
  if (key === 'last7') return 7
  if (key === 'last30') return 30
  if (key === 'quarter') return 90
  // ytd: days since Jan 1 (at least 1 so the window is never empty)
  const jan1 = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  return Math.max(1, Math.ceil((now.getTime() - jan1.getTime()) / DAY))
}

/** the UI filter state compiled to allowlist filter clauses */
export function buildFilterClauses(f: FilterState): { col: string; op?: string; value?: unknown }[] {
  const filters: { col: string; op?: string; value?: unknown }[] = []
  if (f.dept !== 'ALL') filters.push({ col: 'dept', op: 'eq', value: f.dept })
  if (f.priority !== 'ALL') filters.push({ col: 'priority', op: 'eq', value: f.priority })
  if (f.status === 'all') filters.push({ col: 'status', op: 'neq', value: 'cancelled' })
  if (f.status === 'open') filters.push({ col: 'status', op: 'in', value: OPEN_STATUSES })
  if (f.status === 'resolved') filters.push({ col: 'status', op: 'eq', value: 'resolved' })
  if (f.status === 'closed') filters.push({ col: 'status', op: 'eq', value: 'closed' })
  return filters
}

/**
 * The query-live request for a filter state: fetch 2× the period (previous
 * window feeds the KPI deltas) with the UI filters compiled server-side.
 * 'All' status still excludes cancelled — a cancelled request is noise in
 * every widget (the reference's "status ≠ Cancelled" applied chip).
 */
export function buildLiveConfig(f: FilterState, now: Date): ReportConfig {
  const days = periodDays(f.period, now)
  return {
    columns: REQUEST_COLUMNS as string[],
    filters: buildFilterClauses(f),
    period: { from: new Date(now.getTime() - 2 * days * DAY).toISOString() },
  }
}

/**
 * The EXPORT config for a filter state: exactly the applied window (1×, not
 * the delta-feeding 2×) and the same filters — what "Export PDF/XLSX with
 * current filters" and a schedule's filters_snapshot carry.
 */
export function buildExportConfig(f: FilterState, now: Date): ReportConfig {
  const days = periodDays(f.period, now)
  return {
    columns: ['ref', 'title', 'dept', 'service_code', 'service_name', 'status', 'priority', 'created_at', 'sla_met', 'breached'],
    filters: buildFilterClauses(f),
    period: { from: new Date(now.getTime() - days * DAY).toISOString() },
    sort: [{ col: 'created_at', dir: 'desc' }],
  }
}

/** split the 2×-window fetch into the current period and the one before it */
export function splitWindow(rows: RequestRow[], now: Date, days: number): { current: RequestRow[]; previous: RequestRow[] } {
  const cut = now.getTime() - days * DAY
  const current: RequestRow[] = []
  const previous: RequestRow[] = []
  for (const r of rows) (new Date(r.created_at).getTime() >= cut ? current : previous).push(r)
  return { current, previous }
}

const round1 = (n: number) => Math.round(n * 10) / 10

export interface Kpis {
  open: number
  openDelta: number
  slaPct: number | null
  slaPctDelta: number | null
  avgResolutionHours: number | null
  avgResolutionDelta: number | null
  breaches: number
  breachesDelta: number
}

function slaPct(rows: RequestRow[]): number | null {
  const withDue = rows.filter((r) => r.sla_resolution_due !== null)
  if (withDue.length === 0) return null
  return round1((100 * withDue.filter((r) => r.sla_met).length) / withDue.length)
}
function avgRes(rows: RequestRow[]): number | null {
  const resolved = rows.filter((r) => r.resolved_at !== null)
  if (resolved.length === 0) return null
  const hours = resolved.reduce(
    (s, r) => s + (new Date(r.resolved_at!).getTime() - new Date(r.created_at).getTime()) / 3_600_000, 0)
  return round1(hours / resolved.length)
}

export function deriveKpis(current: RequestRow[], previous: RequestRow[]): Kpis {
  const open = (rs: RequestRow[]) => rs.filter((r) => OPEN_STATUSES.includes(r.status)).length
  const breaches = (rs: RequestRow[]) => rs.filter((r) => r.breached).length
  const sla = slaPct(current)
  const slaPrev = slaPct(previous)
  const res = avgRes(current)
  const resPrev = avgRes(previous)
  return {
    open: open(current),
    openDelta: open(current) - open(previous),
    slaPct: sla,
    slaPctDelta: sla !== null && slaPrev !== null ? round1(sla - slaPrev) : null,
    avgResolutionHours: res,
    avgResolutionDelta: res !== null && resPrev !== null ? round1(res - resPrev) : null,
    breaches: breaches(current),
    breachesDelta: breaches(current) - breaches(previous),
  }
}

/** daily created/resolved counts across the current window, oldest first */
export function dailySeries(rows: RequestRow[], days: number, now: Date): { created: number[]; resolved: number[] } {
  const created = new Array<number>(days).fill(0)
  const resolved = new Array<number>(days).fill(0)
  const start = now.getTime() - days * DAY
  for (const r of rows) {
    const c = Math.floor((new Date(r.created_at).getTime() - start) / DAY)
    if (c >= 0 && c < days) created[c]++
    if (r.resolved_at) {
      const d = Math.floor((new Date(r.resolved_at).getTime() - start) / DAY)
      if (d >= 0 && d < days) resolved[d]++
    }
  }
  return { created, resolved }
}

export interface ServiceVolume { code: string; name: string; dept: string; value: number }

export function volumeByService(rows: RequestRow[], topN = 6): ServiceVolume[] {
  const byKey = new Map<string, ServiceVolume>()
  for (const r of rows) {
    const key = `${r.dept}:${r.service_code}`
    const cur = byKey.get(key)
    if (cur) cur.value++
    else byKey.set(key, { code: r.service_code, name: r.service_name, dept: r.dept, value: 1 })
  }
  return [...byKey.values()].sort((a, b) => b.value - a.value || a.code.localeCompare(b.code)).slice(0, topN)
}

/** open requests per priority band, P1 first (donut order = reference order) */
export function openByPriority(rows: RequestRow[]): { priority: string; value: number }[] {
  const open = rows.filter((r) => OPEN_STATUSES.includes(r.status))
  return ['P1', 'P2', 'P3', 'P4'].map((p) => ({ priority: p, value: open.filter((r) => r.priority === p).length }))
}

export interface WeekBucket { label: string; met: number; breached: number; partial: boolean; start: number }

/**
 * SLA met vs breached per week (weeks start Sunday — the working week here),
 * oldest first, current in-progress week flagged partial and starred. Rows
 * without a resolution SLA don't count either way.
 */
export function weeklySla(rows: RequestRow[], now: Date, weeks = 5): WeekBucket[] {
  // most recent Sunday 00:00 UTC
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const thisSunday = today.getTime() - today.getUTCDay() * DAY
  const buckets: WeekBucket[] = []
  for (let i = weeks - 1; i >= 0; i--) {
    const start = thisSunday - i * 7 * DAY
    const d = new Date(start)
    const partial = i === 0
    buckets.push({
      label: `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}${partial ? '*' : ''}`,
      met: 0, breached: 0, partial, start,
    })
  }
  const first = buckets[0].start
  for (const r of rows) {
    if (r.sla_resolution_due === null) continue
    const t = new Date(r.created_at).getTime()
    if (t < first) continue
    const idx = Math.min(buckets.length - 1, Math.floor((t - first) / (7 * DAY)))
    if (r.sla_met) buckets[idx].met++
    else if (r.breached || r.resolved_at) buckets[idx].breached++
  }
  return buckets
}

/* ---- drill-down segmentation ---- */

export type Segment =
  | { kind: 'service'; code: string; dept: string; label: string }
  | { kind: 'priority'; priority: string; label: string }
  | { kind: 'week'; start: number; label: string }
  | { kind: 'day'; index: number; series: 'created' | 'resolved'; label: string }

export function segmentRows(rows: RequestRow[], seg: Segment, now: Date, days: number): RequestRow[] {
  if (seg.kind === 'service') return rows.filter((r) => r.service_code === seg.code && r.dept === seg.dept)
  if (seg.kind === 'priority') return rows.filter((r) => r.priority === seg.priority && OPEN_STATUSES.includes(r.status))
  if (seg.kind === 'week') {
    return rows.filter((r) => {
      if (r.sla_resolution_due === null) return false
      const t = new Date(r.created_at).getTime()
      return t >= seg.start && t < seg.start + 7 * DAY
    })
  }
  const start = now.getTime() - days * DAY + seg.index * DAY
  return rows.filter((r) => {
    const ts = seg.series === 'created' ? r.created_at : r.resolved_at
    if (!ts) return false
    const t = new Date(ts).getTime()
    return t >= start && t < start + DAY
  })
}

/** relative "data as of" stamp for the action bar */
export function asOfLabel(asOf: string, now: Date): string {
  const mins = Math.max(0, Math.round((now.getTime() - new Date(asOf).getTime()) / 60_000))
  if (mins === 0) return 'Data as of just now'
  if (mins === 1) return 'Data as of 1 min ago'
  if (mins < 60) return `Data as of ${mins} min ago`
  return `Data as of ${new Date(asOf).toLocaleTimeString()}`
}
