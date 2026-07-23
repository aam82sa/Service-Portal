/**
 * query-live — the run-time interactivity engine (REPORTING v2 branch 2).
 *
 * Dashboards call this on every filter change: it compiles {source, config,
 * params} through the SAME allowlist compiler generate-report uses (imported
 * from ../generate-report/compiler.ts — one compiler, two consumers), then
 * executes via report_query_caller under the CALLER's own JWT/RLS. No
 * impersonation (the viewer is present), no report_runs row, no artifact.
 * A dept-scoped agent gets only their department's rows; limit 5000, 15s.
 */
import { createClient } from 'npm:@supabase/supabase-js@2'
import { compileQuery, mergeRunParams, CompileError, type ReportConfig } from '../generate-report/compiler.ts'
import { FIXED_SOURCES, SOURCES } from '../generate-report/allowlist.ts'

const env = (k: string) => Deno.env.get(k)

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'content-type': 'application/json' },
  })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const auth = req.headers.get('authorization') ?? ''
  if (!auth.toLowerCase().startsWith('bearer ')) return json({ error: 'sign in required' }, 401)

  // the caller's client: every query below runs under THEIR JWT and RLS
  const caller = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    global: { headers: { authorization: auth } },
    auth: { persistSession: false },
  })
  // getUser() with NO argument looks for a stored session — an edge function
  // never has one, so it fails before ever asking the auth server. Validate
  // the incoming bearer token explicitly.
  const { data: userData, error: userErr } = await caller.auth.getUser(auth.slice(7).trim())
  if (userErr || !userData?.user) return json({ error: 'sign in required' }, 401)

  let body: { source?: string; config?: ReportConfig; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON body' }, 400)
  }
  const source = String(body.source ?? '')
  if (!(source in SOURCES) && !FIXED_SOURCES.has(source)) {
    return json({ error: `unknown data source: ${source}` }, 400)
  }

  // employee performance carries personal data — mirror the 00070 definition
  // gate: reviewers of team performance only, never plain agents/requesters.
  if (source === 'employee_performance') {
    const { data: roles } = await caller
      .from('role_assignments')
      .select('role')
      .eq('profile_id', userData.user.id)
      .in('role', ['dept_head', 'team_lead', 'executive', 'system_admin'])
    if (!roles || roles.length === 0) {
      return json({ error: 'employee performance is restricted to team reviewers' }, 403)
    }
  }

  try {
    const effective = mergeRunParams(body.config ?? {}, body.params ?? {})
    const { sql, columns } = compileQuery(source, effective)
    const { data, error } = await caller.rpc('report_query_caller', { p_sql: sql })
    if (error) return json({ error: error.message }, 400)
    const rows = (data ?? []) as Record<string, unknown>[]
    return json({ columns, rows, row_count: rows.length, as_of: new Date().toISOString() })
  } catch (e) {
    if (e instanceof CompileError) return json({ error: e.message }, 400)
    return json({ error: e instanceof Error ? e.message : 'query failed' }, 500)
  }
})
