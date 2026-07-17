/**
 * Per-report PDF presentation (reporttemplatesspec.md cards 1b–1h): maps a
 * built-in report's rows to the worker template's rich input — KPI band,
 * chart bars, ColumnSpecs (chips, dept rails, number/date formats, tones),
 * totals row, and the personal-data flag. Pure — unit-tested without a DB.
 *
 * Tones are precomputed into hidden `_tone_*` row keys (toneKey) because the
 * payload crosses HTTP to the rendering worker, where functions can't travel.
 * Unknown slugs fall back to plain columns so custom reports still render.
 */

export type Tone = 'green' | 'amber' | 'red' | 'ink' | 'faint'
export interface ColSpec {
  key: string
  label: string
  align?: 'left' | 'right'
  format?: 'text' | 'number' | 'sar' | 'date' | 'datetime' | 'id'
  chip?: 'priority' | 'boolean' | 'status'
  deptRail?: boolean
  toneKey?: string
}
export interface Kpi { value: string; label: string; tone?: Tone }
export interface Bar { label: string; value: number; color: string }

export interface Presentation {
  columns: ColSpec[] | string[]
  rows: Record<string, unknown>[]
  kpis?: Kpi[]
  bars?: Bar[]
  totalsRow?: Record<string, unknown>
  containsPersonalData?: boolean
}

type Row = Record<string, unknown>

const DEPT_COLOR: Record<string, string> = {
  IT: '#3E6DD8', ADMIN: '#8A5FC9', LOG: '#2E9E6B', PROC: '#DE9B2D',
}
const deptColor = (d: unknown) => DEPT_COLOR[String(d ?? '').toUpperCase()] ?? '#5b606b'

const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0
const OPEN_STATUSES = new Set(['new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester', 'escalated'])

function slaTone(pct: unknown): Tone | undefined {
  const p = num(pct)
  if (pct === null || pct === undefined) return undefined
  return p >= 92 ? 'green' : p >= 85 ? 'amber' : 'red'
}

// ---- 1b · Request volume by department (dept × status counts) ----
function requestVolume(rows: Row[]): Presentation {
  const total = rows.reduce((s, r) => s + num(r.count_all), 0)
  const byDept = new Map<string, number>()
  for (const r of rows) byDept.set(String(r.dept), (byDept.get(String(r.dept)) ?? 0) + num(r.count_all))
  const top = [...byDept.entries()].sort((a, b) => b[1] - a[1])[0]
  return {
    columns: [
      { key: 'dept', label: 'Department', deptRail: true },
      { key: 'status', label: 'Status', chip: 'status' },
      { key: 'count_all', label: 'Requests', format: 'number' },
    ],
    rows,
    kpis: [
      { value: String(total), label: 'Total requests' },
      { value: top ? `${top[0]} · ${top[1]}` : '—', label: 'Highest volume' },
      { value: String(byDept.size), label: 'Departments' },
    ],
    bars: [...byDept.entries()].sort((a, b) => b[1] - a[1])
      .map(([dept, value]) => ({ label: dept, value, color: deptColor(dept) })),
    totalsRow: { dept: 'Total', count_all: total },
  }
}

// ---- 1c · SLA compliance ----
function slaCompliance(rows: Row[]): Presentation {
  const withDue = rows.filter((r) => r.sla_resolution_due)
  const met = withDue.filter((r) => r.sla_met === true).length
  const breached = rows.filter((r) => r.breached === true).length
  const now = Date.now()
  const atRisk = rows.filter((r) =>
    r.sla_resolution_due && r.breached !== true && OPEN_STATUSES.has(String(r.status)) &&
    new Date(String(r.sla_resolution_due)).getTime() - now < 4 * 3600_000).length
  const pct = withDue.length ? Math.round((met / withDue.length) * 1000) / 10 : null
  return {
    columns: [
      { key: 'ref', label: 'Ref', format: 'id' },
      { key: 'dept', label: 'Department', deptRail: true },
      { key: 'priority', label: 'Priority', chip: 'priority' },
      { key: 'status', label: 'Status', chip: 'status' },
      { key: 'sla_resolution_due', label: 'Resolution due', format: 'datetime' },
      { key: 'sla_met', label: 'SLA met', chip: 'boolean' },
      { key: 'breached', label: 'Breached', chip: 'boolean' },
    ],
    rows,
    kpis: [
      { value: pct === null ? '—' : `${pct}%`, label: 'Compliance', tone: pct === null ? 'faint' : slaTone(pct) },
      { value: String(met), label: 'Met', tone: 'green' },
      { value: String(breached), label: 'Breached', tone: breached ? 'red' : 'faint' },
      { value: String(atRisk), label: 'At risk (<4h)', tone: atRisk ? 'amber' : 'faint' },
    ],
  }
}

// ---- 1d · Open-request aging ----
function openAging(rows: Row[]): Presentation {
  const ages = rows.map((r) => num(r.age_days)).sort((a, b) => a - b)
  const bucket = (lo: number, hi: number) => ages.filter((a) => a >= lo && a <= hi).length
  const median = ages.length ? ages[Math.floor((ages.length - 1) / 2)] : null
  const toned = rows.map((r) => ({
    ...r,
    _tone_age: num(r.age_days) >= 15 ? 'red' : num(r.age_days) >= 8 ? 'amber' : undefined,
  }))
  return {
    columns: [
      { key: 'ref', label: 'Ref', format: 'id' },
      { key: 'dept', label: 'Department', deptRail: true },
      { key: 'priority', label: 'Priority', chip: 'priority' },
      { key: 'status', label: 'Status', chip: 'status' },
      { key: 'created_at', label: 'Created', format: 'date' },
      { key: 'age_days', label: 'Age (days)', format: 'number', toneKey: '_tone_age' },
    ],
    rows: toned,
    kpis: [
      { value: String(bucket(0, 3)), label: '0–3 days' },
      { value: String(bucket(4, 7)), label: '4–7 days' },
      { value: String(bucket(8, 14)), label: '8–14 days', tone: bucket(8, 14) ? 'amber' : 'faint' },
      { value: String(ages.filter((a) => a >= 15).length), label: '15+ days', tone: ages.some((a) => a >= 15) ? 'red' : 'faint' },
      { value: median === null ? '—' : String(median), label: 'Median age' },
    ],
  }
}

// ---- 1e · Asset inventory (category × status counts) ----
function assetInventory(rows: Row[]): Presentation {
  const total = rows.reduce((s, r) => s + num(r.count_all), 0)
  const byStatus = (st: string) => rows.filter((r) => String(r.status) === st).reduce((s, r) => s + num(r.count_all), 0)
  return {
    columns: [
      { key: 'category', label: 'Category' },
      { key: 'status', label: 'Status', chip: 'status' },
      { key: 'count_all', label: 'Assets', format: 'number' },
    ],
    rows,
    kpis: [
      { value: String(total), label: 'Total assets' },
      { value: String(byStatus('assigned')), label: 'In use', tone: 'green' },
      { value: String(byStatus('in_stock')), label: 'In stock' },
      { value: String(byStatus('retired')), label: 'Retired', tone: 'faint' },
    ],
    totalsRow: { category: 'Total', count_all: total },
  }
}

// ---- 1f · Department performance (fixed aggregate) ----
function deptPerformance(rows: Row[]): Presentation {
  const toned = rows.map((r) => ({ ...r, _tone_sla: slaTone(r.sla_compliance_pct) }))
  return {
    columns: [
      { key: 'dept', label: 'Department', deptRail: true },
      { key: 'total', label: 'Received', format: 'number' },
      { key: 'resolved', label: 'Resolved', format: 'number' },
      { key: 'backlog', label: 'Backlog', format: 'number' },
      { key: 'breached', label: 'Breached', format: 'number' },
      { key: 'sla_compliance_pct', label: 'SLA compliance %', format: 'number', toneKey: '_tone_sla' },
      { key: 'avg_resolution_hours', label: 'Avg resolution (hrs)', format: 'number' },
      { key: 'reopens', label: 'Reopened', format: 'number' },
    ],
    rows: toned,
  }
}

// ---- 1g · Employee performance (fixed aggregate, PERSONAL DATA) ----
function employeePerformance(rows: Row[]): Presentation {
  const toned = rows.map((r) => ({ ...r, _tone_sla: slaTone(r.sla_hit_pct) }))
  return {
    columns: [
      { key: 'agent', label: 'Agent' },
      { key: 'dept', label: 'Department', deptRail: true },
      { key: 'assigned', label: 'Assigned', format: 'number' },
      { key: 'resolved', label: 'Resolved', format: 'number' },
      { key: 'open_load', label: 'Open load', format: 'number' },
      { key: 'sla_hit_pct', label: 'SLA %', format: 'number', toneKey: '_tone_sla' },
      { key: 'avg_resolution_hours', label: 'Avg resolution (hrs)', format: 'number' },
      { key: 'reopens', label: 'Reopened', format: 'number' },
    ],
    rows: toned,
    containsPersonalData: true,
  }
}

// ---- 1h · PMO project status (status × scope counts) ----
function pmoStatus(rows: Row[]): Presentation {
  const byStatus = (st: string) => rows.filter((r) => String(r.status) === st).reduce((s, r) => s + num(r.count_all), 0)
  const total = rows.reduce((s, r) => s + num(r.count_all), 0)
  const byScope = new Map<string, number>()
  for (const r of rows) byScope.set(String(r.department_scope), (byScope.get(String(r.department_scope)) ?? 0) + num(r.count_all))
  return {
    columns: [
      { key: 'status', label: 'Status', chip: 'status' },
      { key: 'department_scope', label: 'Department scope', deptRail: true },
      { key: 'count_all', label: 'Projects', format: 'number' },
    ],
    rows,
    kpis: [
      { value: String(total), label: 'Projects' },
      { value: String(byStatus('on_track') + byStatus('active')), label: 'On track', tone: 'green' },
      { value: String(byStatus('at_risk')), label: 'At risk', tone: byStatus('at_risk') ? 'amber' : 'faint' },
      { value: String(byStatus('delayed')), label: 'Delayed', tone: byStatus('delayed') ? 'red' : 'faint' },
    ],
    bars: [...byScope.entries()].sort((a, b) => b[1] - a[1])
      .map(([scope, value]) => ({ label: scope, value, color: deptColor(scope) })),
    totalsRow: { status: 'Total', count_all: total },
  }
}

const BY_SLUG: Record<string, (rows: Row[]) => Presentation> = {
  'request-volume-by-dept': requestVolume,
  'sla-compliance': slaCompliance,
  'open-request-aging': openAging,
  'asset-inventory': assetInventory,
  'department-performance': deptPerformance,
  'employee-performance': employeePerformance,
  'pmo-project-status': pmoStatus,
}

/** Rich presentation for a built-in slug; plain columns for everything else. */
export function buildPresentation(slug: string | null, columns: string[], rows: Row[]): Presentation {
  const builder = slug ? BY_SLUG[slug] : undefined
  if (builder) return builder(rows)
  return { columns, rows }
}
