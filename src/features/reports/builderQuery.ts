/**
 * Widget config → query-live request. Pure — the builder's live preview and
 * (later) the dashboard renderer both compile a widget through here, so what
 * you see while editing is exactly what the widget will fetch.
 */

import type { ReportConfig } from './api'
import { sourceMeta, type WidgetType } from './builderMeta'

export interface WidgetFilter { col: string; op: 'eq' | 'neq'; value: string }

export interface WidgetConfig {
  measure?: string          // key into the source's measures (default: first)
  group_by?: string         // key into the source's groupable
  split_by?: string | null  // second grouping dimension (stacked/pivot)
  filters?: WidgetFilter[]
  period?: { preset: 'last30' | 'quarter' | 'follow' }
  limit?: number
}

export interface WidgetDraft {
  id?: string
  widget_type: WidgetType
  data_source: string
  title: string
  config: WidgetConfig
}

const DAY = 86_400_000

export function periodFrom(preset: 'last30' | 'quarter' | 'follow' | undefined, now: Date): string | null {
  if (preset === 'quarter') return new Date(now.getTime() - 90 * DAY).toISOString()
  if (preset === 'follow') return null // the dashboard's own filter applies at render time
  return new Date(now.getTime() - 30 * DAY).toISOString()
}

/** true when this widget type can preview through a compiled aggregate today */
export const previewSupported = (t: WidgetType): boolean =>
  t === 'kpi' || t === 'bar' || t === 'donut' || t === 'table'

/**
 * Build the query-live ReportConfig for one widget. KPI = bare aggregate;
 * bar/donut = group_by + aggregate sorted desc; table = the source's default
 * columns. Fixed sources (dept/employee performance) compile wholesale and
 * ignore measure/group picks.
 */
export function widgetToConfig(w: WidgetDraft, now: Date): ReportConfig {
  const meta = sourceMeta(w.data_source)
  // drop filters the source can't bind (e.g. the default "status ≠ cancelled"
  // when the widget is re-bound to audit) — a kept one would be a compile error
  const filters = (w.config.filters ?? [])
    .filter((f) => meta.fixed ? f.col === 'dept' : (meta.filterable ?? []).includes(f.col))
    .map((f) => ({ col: f.col, op: f.op, value: f.value }))
  const from = periodFrom(w.config.period?.preset, now)

  if (meta.fixed) {
    // dept/employee performance: fixed shape, dept filters only (period is
    // always created_at inside compileFixed)
    return { filters: filters.filter((f) => f.col === 'dept'), ...(from ? { period: { from } } : {}) }
  }

  // a source with no filterable date column silently drops the period —
  // emitting one would be a guaranteed compile error
  const period = from && meta.periodCol
    ? { from, ...(meta.periodCol !== 'created_at' ? { col: meta.periodCol } : {}) }
    : undefined

  const measure = meta.measures.find((m) => m.key === w.config.measure) ?? meta.measures[0]
  const agg = measure.fn === 'count'
    ? { fn: 'count', as: 'value' }
    : { fn: measure.fn, col: measure.col, as: 'value' }

  if (w.widget_type === 'kpi') {
    return { aggregations: [agg], filters, ...(period ? { period } : {}) }
  }
  if (w.widget_type === 'bar' || w.widget_type === 'donut') {
    const group = meta.groupable.find((g) => g.key === w.config.group_by) ?? meta.groupable[0]
    return {
      group_by: [group.key],
      aggregations: [agg],
      filters,
      sort: [{ col: 'value', dir: 'desc' }],
      ...(period ? { period } : {}),
    }
  }
  // table (and, until their previews land, line/stacked/pivot): default columns
  return { filters, ...(period ? { period } : {}) }
}
