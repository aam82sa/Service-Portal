/**
 * Data layer for the reports feature. All reads go through RLS (report_*
 * policies); running a report inserts a report_run "as yourself" and then asks
 * the generate-report Edge Function to compile + render it under your own
 * access. Emailing and scheduling call the matching Edge Function / tables.
 */

import { supabase } from '../../lib/supabase'
import { parseCsv } from './csv'

export type Format = 'pdf' | 'csv' | 'xlsx'

export interface ReportConfig {
  columns?: string[]
  filters?: { col: string; op?: string; value?: unknown }[]
  group_by?: string[]
  aggregations?: { fn: string; col?: string; as?: string }[]
  period?: { from?: string; to?: string; col?: string }
  chart?: { type?: string } | null
}

export interface ReportDefinition {
  id: string
  slug: string
  name: string
  description: string | null
  kind: 'builtin' | 'custom'
  data_source: string
  config: ReportConfig
  output_formats: Format[]
  visibility: 'private' | 'dept' | 'org'
  dept: string | null
  owner_id: string | null
  contains_personal_data: boolean
}

export interface ReportRun {
  id: string
  definition_id: string
  trigger: string
  status: 'queued' | 'running' | 'succeeded' | 'failed'
  format: string
  row_count: number | null
  artifact_path: string | null
  error: string | null
  created_at: string
  finished_at: string | null
}

export interface ReportSchedule {
  id: string
  definition_id: string
  cadence: string
  timezone: string
  format: string
  recipients: { profile_ids?: string[]; external?: string[] }
  run_as_owner: string
  enabled: boolean
  next_run_at: string | null
  last_run_at: string | null
}

export async function listDefinitions(): Promise<ReportDefinition[]> {
  const { data, error } = await supabase
    .from('report_definitions')
    .select('id, slug, name, description, kind, data_source, config, output_formats, visibility, dept, owner_id, contains_personal_data')
    .eq('is_active', true)
    .order('kind', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw error
  return (data ?? []) as ReportDefinition[]
}

export async function listRuns(definitionId: string, limit = 20): Promise<ReportRun[]> {
  const { data, error } = await supabase
    .from('report_runs')
    .select('id, definition_id, trigger, status, format, row_count, artifact_path, error, created_at, finished_at')
    .eq('definition_id', definitionId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as ReportRun[]
}

export interface RunResult { runId: string; downloadUrl: string | null; rowCount: number | null; error?: string }

/** Create the run row (RLS: as yourself) then have generate-report produce it. */
export async function runReport(
  def: ReportDefinition,
  ownerId: string,
  format: Format,
  trigger: 'download' | 'email' = 'download',
): Promise<RunResult> {
  const { data: run, error } = await supabase
    .from('report_runs')
    .insert({ definition_id: def.id, trigger, format, requested_by: ownerId, run_as_owner: ownerId, params: {} })
    .select('id')
    .single()
  if (error || !run) throw error ?? new Error('could not create run')
  const runId = (run as { id: string }).id
  const { data, error: fnErr } = await supabase.functions.invoke('generate-report', { body: { run_id: runId } })
  if (fnErr) return { runId, downloadUrl: null, rowCount: null, error: fnErr.message }
  const res = data as { download_url?: string; row_count?: number; error?: string }
  return { runId, downloadUrl: res?.download_url ?? null, rowCount: res?.row_count ?? null, error: res?.error }
}

export interface Preview { columns: string[]; rows: string[][]; rowCount: number }

/** Run a CSV pass and parse the artifact for an on-screen table preview. */
export async function previewReport(def: ReportDefinition, ownerId: string, cap = 50): Promise<Preview> {
  const res = await runReport(def, ownerId, 'csv', 'download')
  if (!res.downloadUrl) throw new Error(res.error ?? 'preview failed')
  const text = await (await fetch(res.downloadUrl)).text()
  const table = parseCsv(text)
  const columns = table[0] ?? []
  const rows = table.slice(1)
  return { columns, rows: rows.slice(0, cap), rowCount: res.rowCount ?? rows.length }
}

export async function emailReport(runId: string, recipients: { profile_ids?: string[]; external?: string[] }) {
  const { data, error } = await supabase.functions.invoke('send-notification', {
    body: { mode: 'report', run_id: runId, recipients },
  })
  if (error) throw error
  return data as { ok: boolean; sent: number; mode: string; refused: { address: string; reason: string }[]; skipped?: string }
}

export async function listSchedules(definitionId: string): Promise<ReportSchedule[]> {
  const { data, error } = await supabase
    .from('report_schedules')
    .select('id, definition_id, cadence, timezone, format, recipients, run_as_owner, enabled, next_run_at, last_run_at')
    .eq('definition_id', definitionId)
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as ReportSchedule[]
}

export async function createSchedule(input: {
  definitionId: string
  cadence: string
  timezone: string
  format: Format
  ownerId: string
  recipients: { profile_ids?: string[]; external?: string[] }
}): Promise<void> {
  const { data: next } = await supabase.rpc('report_next_run', {
    p_expr: input.cadence, p_tz: input.timezone, p_after: new Date().toISOString(),
  })
  const { error } = await supabase.from('report_schedules').insert({
    definition_id: input.definitionId,
    cadence: input.cadence,
    timezone: input.timezone,
    format: input.format,
    recipients: input.recipients,
    run_as_owner: input.ownerId,
    enabled: true,
    next_run_at: (next as string | null) ?? null,
  })
  if (error) throw error
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<void> {
  const { error } = await supabase.from('report_schedules').update({ enabled }).eq('id', id)
  if (error) throw error
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await supabase.from('report_schedules').delete().eq('id', id)
  if (error) throw error
}

/**
 * A fresh signed URL for a stored artifact. The reports bucket read policy
 * allows the run owner (their folder) and admins, so this works client-side
 * for exactly the people who may see the report.
 */
export async function artifactSignedUrl(path: string, expiresIn = 300): Promise<string> {
  const { data, error } = await supabase.storage.from('reports').createSignedUrl(path, expiresIn)
  if (error || !data?.signedUrl) throw error ?? new Error('could not sign artifact url')
  return data.signedUrl
}
