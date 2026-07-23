/**
 * Print the dashboard through the v1 engine. Exporting creates (or rewrites)
 * ONE private "export" definition per dashboard per owner — reports stay
 * config, the run goes through generate-report exactly like any document
 * (owner-RLS, artifact, run history), and Email/Schedule reuse the v1
 * delivery unchanged. A schedule additionally freezes the CURRENT filters
 * into filters_snapshot, since this shared definition is rewritten by every
 * later export click.
 */

import { supabase } from '../../lib/supabase'
import type { FilterState } from './analyticsData'
import { buildExportConfig } from './analyticsData'
import type { ReportConfig, ReportDefinition } from './api'
import { PERIOD_LABEL } from './analyticsData'
import type { CuratedDashboard } from './dashboards'

export const exportSlug = (dashSlug: string, ownerId: string): string =>
  `export-${dashSlug}-${ownerId.slice(0, 8)}`

export const exportSubtitle = (dash: CuratedDashboard, f: FilterState): string => {
  const parts = [PERIOD_LABEL[f.period]]
  if (f.dept !== 'ALL') parts.push(f.dept)
  if (f.priority !== 'ALL') parts.push(f.priority)
  parts.push(f.status === 'all' ? 'excl. cancelled' : f.status)
  return `${dash.name} · ${parts.join(' · ')}`
}

/**
 * Upsert the owner's export definition for this dashboard with the current
 * filters compiled in, and return it ready for runReport().
 */
export async function ensureExportDefinition(
  dash: CuratedDashboard,
  filters: FilterState,
  ownerId: string,
  now = new Date(),
): Promise<ReportDefinition> {
  const slug = exportSlug(dash.slug, ownerId)
  const config: ReportConfig = buildExportConfig(filters, now)
  const description = exportSubtitle(dash, filters)

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
      .update({ config, description, name: `${dash.name} — export`, is_active: true })
      .eq('id', id)
    if (error) throw error
    return {
      id, slug, name: `${dash.name} — export`, description, kind: 'custom',
      data_source: 'requests', config, output_formats: ['pdf', 'csv', 'xlsx'],
      visibility: 'private', dept: null, owner_id: ownerId, contains_personal_data: false,
    }
  }

  const { data, error } = await supabase
    .from('report_definitions')
    .insert({
      slug, name: `${dash.name} — export`, description, kind: 'custom',
      data_source: 'requests', config, output_formats: ['pdf', 'csv', 'xlsx'],
      visibility: 'private', owner_id: ownerId,
    })
    .select('id')
    .single()
  if (error || !data) throw error ?? new Error('could not create export definition')
  return {
    id: (data as { id: string }).id, slug, name: `${dash.name} — export`, description,
    kind: 'custom', data_source: 'requests', config, output_formats: ['pdf', 'csv', 'xlsx'],
    visibility: 'private', dept: null, owner_id: ownerId, contains_personal_data: false,
  }
}
