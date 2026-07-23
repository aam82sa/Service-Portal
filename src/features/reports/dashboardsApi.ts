/**
 * CRUD for report_dashboards/report_widgets (00088). Everything goes through
 * RLS as the signed-in user: private/dept/org reads, owner-only writes,
 * builtin admin-only — the policies mirror report_definitions, so nothing
 * here needs its own permission logic.
 */

import { supabase } from '../../lib/supabase'
import type { WidgetDraft } from './builderQuery'
import type { WidgetType } from './builderMeta'

export interface DashboardRow {
  id: string
  slug: string
  name: string
  kind: 'builtin' | 'custom'
  visibility: 'private' | 'dept' | 'org'
  dept_id: string | null
  owner_id: string | null
  is_active: boolean
  updated_at: string
}

export interface WidgetRow {
  id: string
  dashboard_id: string
  position: number
  widget_type: WidgetType
  data_source: string
  config: Record<string, unknown>
  title: string
}

export async function listDashboards(): Promise<DashboardRow[]> {
  const { data, error } = await supabase
    .from('report_dashboards')
    .select('id, slug, name, kind, visibility, dept_id, owner_id, is_active, updated_at')
    .eq('is_active', true)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as DashboardRow[]
}

export async function getDashboardWidgets(dashboardId: string): Promise<WidgetRow[]> {
  const { data, error } = await supabase
    .from('report_widgets')
    .select('id, dashboard_id, position, widget_type, data_source, config, title')
    .eq('dashboard_id', dashboardId)
    .order('position', { ascending: true })
  if (error) throw error
  return (data ?? []) as WidgetRow[]
}

export interface SaveDashboardInput {
  id?: string // present = update in place
  name: string
  visibility: 'private' | 'dept' | 'org'
  deptId: string | null
  ownerId: string
  widgets: WidgetDraft[]
}

const slugify = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'dashboard'

/**
 * Create or update a dashboard with its widgets. Widgets are replaced
 * wholesale (delete + insert) — positions are the array order, and the RLS
 * write policy re-checks dashboard ownership on every row.
 */
export async function saveDashboard(input: SaveDashboardInput): Promise<string> {
  let dashboardId = input.id
  if (dashboardId) {
    const { error } = await supabase
      .from('report_dashboards')
      .update({ name: input.name, visibility: input.visibility, dept_id: input.deptId })
      .eq('id', dashboardId)
    if (error) throw error
    const { error: delErr } = await supabase.from('report_widgets').delete().eq('dashboard_id', dashboardId)
    if (delErr) throw delErr
  } else {
    const slug = `${slugify(input.name)}-${Math.random().toString(36).slice(2, 7)}`
    const { data, error } = await supabase
      .from('report_dashboards')
      .insert({
        slug, name: input.name, kind: 'custom',
        visibility: input.visibility, dept_id: input.deptId, owner_id: input.ownerId,
      })
      .select('id')
      .single()
    if (error || !data) throw error ?? new Error('could not create dashboard')
    dashboardId = (data as { id: string }).id
  }

  if (input.widgets.length) {
    const rows = input.widgets.map((w, i) => ({
      dashboard_id: dashboardId,
      position: i,
      widget_type: w.widget_type,
      data_source: w.data_source,
      config: w.config,
      title: w.title,
    }))
    const { error } = await supabase.from('report_widgets').insert(rows)
    if (error) throw error
  }
  return dashboardId
}

export async function deleteDashboard(id: string): Promise<void> {
  const { error } = await supabase.from('report_dashboards').delete().eq('id', id)
  if (error) throw error
}

export interface DeptOption { id: string; code: string; name: string }

export async function listDepartments(): Promise<DeptOption[]> {
  const { data, error } = await supabase
    .from('departments')
    .select('id, code, name')
    .order('code')
  if (error) throw error
  return (data ?? []) as DeptOption[]
}
