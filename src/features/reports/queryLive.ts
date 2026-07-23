/**
 * Client for the query-live Edge Function (branch 2): compile {source,
 * config, params} through the allowlist compiler and run it under the
 * CALLER's own JWT/RLS. No report_runs row, no artifact — this is what makes
 * dashboard filters instant. Rows come back as objects keyed by the compiled
 * column names; `as_of` feeds the "data as of" stamp.
 */

import { supabase } from '../../lib/supabase'
import type { ReportConfig } from './api'

export interface LiveResult {
  columns: string[]
  rows: Record<string, unknown>[]
  row_count: number
  as_of: string
}

export async function queryLive(
  source: string,
  config: ReportConfig,
  params: Record<string, unknown> = {},
): Promise<LiveResult> {
  const { data, error } = await supabase.functions.invoke('query-live', {
    body: { source, config, params },
  })
  if (error) throw error
  const res = data as Partial<LiveResult> & { error?: string }
  if (res?.error) throw new Error(res.error)
  return {
    columns: res.columns ?? [],
    rows: (res.rows ?? []) as Record<string, unknown>[],
    row_count: res.row_count ?? 0,
    as_of: res.as_of ?? new Date().toISOString(),
  }
}
