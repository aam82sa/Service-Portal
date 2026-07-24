/**
 * Print the dashboard through the v1 engine — as a DASHBOARD DOCUMENT, not a
 * record list. The export definition's config carries `sections`: one entry
 * per widget with a title, a presentation kind, and the widget's compiled
 * QUERY (never values — every run, manual or scheduled, recomputes under the
 * owner's RLS at run time). generate-report renders a KPI band, titled bar
 * blocks and titled tables in the PDF, and one sheet per widget in XLSX.
 * Email/Schedule reuse the v1 delivery on the produced run; a schedule
 * freezes the sections into filters_snapshot because this shared definition
 * is rewritten by every later export click.
 */

import { supabase } from '../../lib/supabase'
import type { FilterState } from './analyticsData'
import { buildExportConfig, buildFilterClauses, periodDays, PERIOD_LABEL } from './analyticsData'
import type { ReportConfig, ReportDefinition } from './api'
import { widgetToConfig, type WidgetDraft } from './builderQuery'
import type { CuratedDashboard } from './dashboards'

export type SectionKind = 'kpi' | 'bar' | 'table'

export interface ExportSection {
  title: string
  kind: SectionKind
  source: string
  query: ReportConfig
}

export const exportSlug = (dashSlug: string, ownerId: string): string =>
  `export-${dashSlug}-${ownerId.slice(0, 8)}`

export const exportSubtitle = (dash: { name: string }, f: FilterState): string => {
  const parts = [PERIOD_LABEL[f.period]]
  if (f.dept !== 'ALL') parts.push(f.dept)
  if (f.priority !== 'ALL') parts.push(f.priority)
  parts.push(f.status === 'all' ? 'excl. cancelled' : f.status)
  return `${dash.name} · ${parts.join(' · ')}`
}

const DAY = 86_400_000

/**
 * The Zone 1 curated overview as a dashboard document: KPI + the three
 * groupable widgets + the underlying records, all carrying the CURRENT
 * run-time filters and exactly the applied window (1×).
 */
export function curatedSections(f: FilterState, now: Date): ExportSection[] {
  const filters = buildFilterClauses(f)
  const period = { from: new Date(now.getTime() - periodDays(f.period, now) * DAY).toISOString() }
  const grouped = (group: string): ReportConfig => ({
    group_by: [group],
    aggregations: [{ fn: 'count', as: 'value' }],
    filters,
    sort: [{ col: 'value', dir: 'desc' }],
    period,
  })
  return [
    { title: 'Requests in period', kind: 'kpi', source: 'requests', query: { aggregations: [{ fn: 'count', as: 'value' }], filters, period } },
    { title: 'Volume by service', kind: 'bar', source: 'requests', query: grouped('service_code') },
    { title: 'By priority', kind: 'bar', source: 'requests', query: grouped('priority') },
    { title: 'By status', kind: 'bar', source: 'requests', query: grouped('status') },
    { title: 'Underlying records', kind: 'table', source: 'requests', query: buildExportConfig(f, now) },
  ]
}

/** a saved board's widgets as sections — the same widgetToConfig the builder previews with */
export function boardSections(widgets: WidgetDraft[], now: Date): ExportSection[] {
  return widgets.map((w) => ({
    title: w.title,
    kind: w.widget_type === 'kpi' ? 'kpi' : w.widget_type === 'bar' || w.widget_type === 'donut' ? 'bar' : 'table',
    source: w.data_source,
    query: widgetToConfig(w, now),
  }))
}

/**
 * Upsert the owner's export definition for a dashboard (curated or saved)
 * with the current sections compiled in, ready for runReport(). One
 * definition per dashboard per owner — rewritten in place, never duplicated.
 */
export async function ensureExportDefinition(input: {
  slugKey: string
  name: string
  description: string
  sections: ExportSection[]
  ownerId: string
}): Promise<ReportDefinition> {
  const slug = exportSlug(input.slugKey, input.ownerId)
  const config = { sections: input.sections } as unknown as ReportConfig
  const name = `${input.name} — export`
  const base: Omit<ReportDefinition, 'id'> = {
    slug, name, description: input.description, kind: 'custom',
    data_source: 'requests', config, output_formats: ['pdf', 'xlsx'],
    visibility: 'private', dept: null, owner_id: input.ownerId, contains_personal_data: false,
  }

  const { data: existing, error: selErr } = await supabase
    .from('report_definitions')
    .select('id')
    .eq('slug', slug)
    .maybeSingle()
  if (selErr) throw selErr

  if (existing) {
    const id = (existing as { id: string }).id
    const { error } = await supabase
      .from('report_definitions')
      .update({ config, description: input.description, name, output_formats: ['pdf', 'xlsx'], is_active: true })
      .eq('id', id)
    if (error) throw error
    return { id, ...base }
  }

  const { data, error } = await supabase
    .from('report_definitions')
    .insert({
      slug, name, description: input.description, kind: 'custom',
      data_source: 'requests', config, output_formats: ['pdf', 'xlsx'],
      visibility: 'private', owner_id: input.ownerId,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('could not create export definition')
  return { id: (data as { id: string }).id, ...base }
}
