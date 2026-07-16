/**
 * Query compiler — turns a report definition's `config` into a single read-only
 * SQL SELECT, built ONLY from the per-data-source ALLOWLIST (allowlist.ts).
 *
 * This is the first of two independent safety guards. Nothing here ever emits a
 * table or column the allowlist doesn't name, and every user-supplied filter
 * VALUE is escaped/validated by type before it reaches the string. The compiled
 * query is then run under the owner's RLS by report_run_query() (00067) — that
 * is the second guard. A definition can therefore be authored by any user
 * without granting them raw SQL.
 *
 * The output is a bare `select … from … [where] [group by] [order by]` with no
 * trailing semicolon and no CTE — report_fetch_rows() rejects anything else and
 * wraps it in `select * from (…) limit 5000`.
 */

import { FIXED_SOURCES, SOURCES, type Agg, type SourceSpec } from './allowlist.ts'

export type FilterOp =
  | 'eq' | 'neq' | 'in' | 'gt' | 'gte' | 'lt' | 'lte' | 'between' | 'is_null' | 'not_null'

export interface FilterClause {
  col: string
  op?: FilterOp
  value?: unknown
}
export interface Aggregation {
  fn: Agg
  col?: string        // omitted (or '*') means count(*)
  as?: string
}
export interface SortClause {
  col: string         // must name a column that appears in the SELECT output
  dir?: 'asc' | 'desc'
}
export interface Period {
  from?: string       // ISO date/timestamp, inclusive lower bound
  to?: string         // ISO date/timestamp, inclusive upper bound
  col?: string        // filterable date column to bound (default created_at)
}
export interface ReportConfig {
  columns?: string[]
  filters?: FilterClause[]
  group_by?: string[]
  aggregations?: Aggregation[]
  sort?: SortClause[]
  period?: Period
  chart?: unknown     // presentation only — ignored by the compiler
}

export interface CompiledQuery {
  sql: string
  /** ordered output column keys — the CSV/XLSX header row */
  columns: string[]
}

/** Thrown for any definition the allowlist can't satisfy. Never leaks SQL. */
export class CompileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CompileError'
  }
}

const AGGS = new Set<string>(['count', 'sum', 'avg', 'min', 'max'])
const FILTER_OPS = new Set<string>(['eq', 'neq', 'in', 'gt', 'gte', 'lt', 'lte', 'between', 'is_null', 'not_null'])
const OP_SQL: Record<string, string> = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }
const DATE_RE = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}(:\d{2})?)?)?$/

// ---- typed literal escaping (the value guard) ----

function litText(v: unknown): string {
  const s = String(v ?? '')
  if (s.includes('\u0000')) throw new CompileError('filter value contains a null byte')
  if (s.length > 200) throw new CompileError('filter value too long')
  return `'${s.replace(/'/g, "''")}'` // standard_conforming_strings is on: doubling the quote is sufficient
}
function litIdent(v: unknown): string {
  const s = String(v ?? '')
  if (!/^[A-Za-z0-9_\- ]{1,64}$/.test(s)) throw new CompileError(`invalid identifier value: ${s}`)
  return `'${s}'`
}
function litNumber(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(String(v).trim())
  if (!Number.isFinite(n)) throw new CompileError(`invalid numeric value: ${String(v)}`)
  return String(n)
}
function litDate(v: unknown): string {
  const s = String(v ?? '').trim()
  if (!DATE_RE.test(s)) throw new CompileError(`invalid date value: ${s}`)
  return `'${s}'::timestamptz`
}
function literal(v: unknown, type: 'text' | 'number' | 'date' | 'ident'): string {
  switch (type) {
    case 'number': return litNumber(v)
    case 'date': return litDate(v)
    case 'ident': return litIdent(v)
    default: return litText(v)
  }
}

function aggAlias(a: Aggregation): string {
  const raw = a.as ?? `${a.fn}_${a.col ?? 'all'}`
  const alias = raw.toLowerCase().replace(/[^a-z0-9_]/g, '_').replace(/^_+|_+$/g, '')
  if (!alias) throw new CompileError(`invalid aggregation alias: ${String(a.as)}`)
  return alias
}

// ---- WHERE builder, shared by free-column sources ----

function buildWhere(spec: SourceSpec, config: ReportConfig): string[] {
  const conds: string[] = []
  for (const f of config.filters ?? []) {
    const type = spec.filterable[f.col]
    if (!type) throw new CompileError(`column not filterable: ${f.col}`)
    const expr = spec.columns[f.col]
    const op = f.op ?? 'eq'
    if (!FILTER_OPS.has(op)) throw new CompileError(`unknown operator: ${op}`)

    if (op === 'is_null') { conds.push(`${expr} is null`); continue }
    if (op === 'not_null') { conds.push(`${expr} is not null`); continue }
    if (op === 'in') {
      const arr = Array.isArray(f.value) ? f.value : [f.value]
      if (arr.length === 0) throw new CompileError(`empty IN list for ${f.col}`)
      conds.push(`${expr} in (${arr.map((v) => literal(v, type)).join(', ')})`)
      continue
    }
    if (op === 'between') {
      const arr = Array.isArray(f.value) ? f.value : []
      if (arr.length !== 2) throw new CompileError(`between needs [a, b] for ${f.col}`)
      conds.push(`${expr} between ${literal(arr[0], type)} and ${literal(arr[1], type)}`)
      continue
    }
    conds.push(`${expr} ${OP_SQL[op]} ${literal(f.value, type)}`)
  }

  const p = config.period
  if (p && (p.from || p.to)) {
    const col = p.col ?? (spec.filterable['created_at'] ? 'created_at' : '')
    if (!col || spec.filterable[col] !== 'date') {
      throw new CompileError('period requires a filterable date column')
    }
    const expr = spec.columns[col]
    if (p.from) conds.push(`${expr} >= ${litDate(p.from)}`)
    if (p.to) conds.push(`${expr} <= ${litDate(p.to)}`)
  }
  return conds
}

// ---- the two fixed aggregate shapes (dept / employee performance) ----

function fixedWhere(config: ReportConfig): string {
  const conds: string[] = []
  const p = config.period
  if (p?.from) conds.push(`r.created_at >= ${litDate(p.from)}`)
  if (p?.to) conds.push(`r.created_at <= ${litDate(p.to)}`)
  for (const f of config.filters ?? []) {
    if (f.col !== 'dept') throw new CompileError(`filter not allowed on this report: ${f.col}`)
    const arr = Array.isArray(f.value) ? f.value : [f.value]
    if (arr.length === 0) throw new CompileError('empty dept filter')
    conds.push(`r.dept::text in (${arr.map(litIdent).join(', ')})`)
  }
  return conds.length ? ` where ${conds.join(' and ')}` : ''
}

function compileFixed(dataSource: string, config: ReportConfig): CompiledQuery {
  const where = fixedWhere(config)
  if (dataSource === 'dept_performance') {
    const columns = ['dept', 'total', 'resolved', 'backlog', 'breached', 'sla_compliance_pct', 'avg_resolution_hours', 'reopens']
    const sql =
      `select r.dept::text as "dept", ` +
      `count(*) as "total", ` +
      `count(*) filter (where r.status in ('resolved','closed')) as "resolved", ` +
      `count(*) filter (where r.status not in ('resolved','closed','cancelled')) as "backlog", ` +
      `count(*) filter (where r.sla_resolution_due is not null and r.status not in ('resolved','closed','cancelled') and r.sla_resolution_due < now()) as "breached", ` +
      `round(100.0 * count(*) filter (where r.sla_resolution_due is not null and r.updated_at <= r.sla_resolution_due) / nullif(count(*) filter (where r.sla_resolution_due is not null), 0), 1) as "sla_compliance_pct", ` +
      `round((avg(extract(epoch from (r.resolved_at - r.created_at)) / 3600.0) filter (where r.resolved_at is not null))::numeric, 1) as "avg_resolution_hours", ` +
      `coalesce(sum(r.reopened_count), 0) as "reopens" ` +
      `from requests r${where} group by r.dept order by r.dept`
    return { sql, columns }
  }
  if (dataSource === 'employee_performance') {
    const columns = ['agent', 'dept', 'assigned', 'resolved', 'open_load', 'sla_hit_pct', 'avg_resolution_hours', 'reopens']
    const sql =
      `select p.display_name as "agent", r.dept::text as "dept", ` +
      `count(*) as "assigned", ` +
      `count(*) filter (where r.status in ('resolved','closed')) as "resolved", ` +
      `count(*) filter (where r.status not in ('resolved','closed','cancelled')) as "open_load", ` +
      `round(100.0 * count(*) filter (where r.sla_resolution_due is not null and r.updated_at <= r.sla_resolution_due) / nullif(count(*) filter (where r.sla_resolution_due is not null), 0), 1) as "sla_hit_pct", ` +
      `round((avg(extract(epoch from (r.resolved_at - r.created_at)) / 3600.0) filter (where r.resolved_at is not null))::numeric, 1) as "avg_resolution_hours", ` +
      `coalesce(sum(r.reopened_count), 0) as "reopens" ` +
      `from requests r join profiles p on p.id = r.assignee_id${where} ` +
      `group by p.display_name, r.dept order by p.display_name`
    return { sql, columns }
  }
  throw new CompileError(`unknown fixed data source: ${dataSource}`)
}

// ---- entry point ----

export function compileQuery(dataSource: string, config: ReportConfig = {}): CompiledQuery {
  if (FIXED_SOURCES.has(dataSource)) return compileFixed(dataSource, config)

  const spec = SOURCES[dataSource]
  if (!spec) throw new CompileError(`unknown data source: ${dataSource}`)

  const isAgg = (config.aggregations?.length ?? 0) > 0 || (config.group_by?.length ?? 0) > 0
  const select: string[] = []
  const columns: string[] = []

  if (isAgg) {
    for (const g of config.group_by ?? []) {
      if (!spec.groupable.includes(g)) throw new CompileError(`column not groupable: ${g}`)
      select.push(`${spec.columns[g]} as "${g}"`)
      columns.push(g)
    }
    for (const a of config.aggregations ?? []) {
      if (!AGGS.has(a.fn)) throw new CompileError(`unknown aggregation: ${a.fn}`)
      let inner: string
      if (a.fn === 'count' && (!a.col || a.col === '*')) {
        inner = '*'
      } else {
        if (!a.col || !spec.columns[a.col]) throw new CompileError(`column not selectable: ${String(a.col)}`)
        inner = spec.columns[a.col]
      }
      const alias = aggAlias(a)
      select.push(`${a.fn}(${inner}) as "${alias}"`)
      columns.push(alias)
    }
    if (select.length === 0) throw new CompileError('aggregate report needs group_by or aggregations')
  } else {
    const cols = config.columns && config.columns.length ? config.columns : spec.defaults
    for (const c of cols) {
      if (!spec.columns[c]) throw new CompileError(`column not selectable: ${c}`)
      select.push(`${spec.columns[c]} as "${c}"`)
      columns.push(c)
    }
  }

  let sql = `select ${select.join(', ')} from ${spec.from}`

  const where = buildWhere(spec, config)
  if (where.length) sql += ` where ${where.join(' and ')}`

  const groupExprs = (config.group_by ?? []).map((g) => spec.columns[g])
  if (groupExprs.length) sql += ` group by ${groupExprs.join(', ')}`

  const order: string[] = []
  for (const s of config.sort ?? []) {
    if (!columns.includes(s.col)) throw new CompileError(`cannot sort by ${s.col}: not in output`)
    order.push(`"${s.col}" ${s.dir === 'desc' ? 'desc' : 'asc'}`)
  }
  if (order.length) sql += ` order by ${order.join(', ')}`

  return { sql, columns }
}
