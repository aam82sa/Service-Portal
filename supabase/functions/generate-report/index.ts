/**
 * generate-report — runs one report_run end to end:
 *   1. authenticate (shared secret for cron/schedule calls, else a caller JWT
 *      that owns/requested the run),
 *   2. load the run + its definition,
 *   3. compile the definition config to allowlisted SQL (compiler.ts),
 *   4. fetch rows via report_fetch_rows() — the query runs under the OWNER's
 *      RLS, so a report can never contain a row the owner couldn't see,
 *   5. render CSV/XLSX inline, or PDF via the worker/pdf-lib fallback,
 *   6. store the artifact in the private `reports` bucket and stamp the run
 *      succeeded/failed with a signed download URL.
 *
 * The `reporting` feature flag gates everything (off ⇒ 200 skipped). Large runs
 * left `queued` are picked up by the scheduling drainer (Branch 5).
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { compileQuery, mergeRunParams, type ReportConfig } from './compiler.ts'
import { artifactMeta, sectionsToXLSX, toCSV, toXLSX } from './render.ts'
import { renderReportPdf, type PdfSection } from './pdf.ts'
import { compileSections, parseSections } from './sections.ts'
import { buildPresentation } from './presentation.ts'

const env = (k: string) => Deno.env.get(k)

/** Browser calls require CORS: allow the app origin's preflight + headers. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })

function admin() {
  return createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)
}

interface DefinitionRow {
  data_source: string
  config: ReportConfig | null
  name: string | null
  slug: string | null
}
interface RunRow {
  id: string
  status: string
  format: string
  run_as_owner: string
  requested_by: string | null
  attempts: number | null
  definition: DefinitionRow | DefinitionRow[] | null
}

function periodLabel(config: ReportConfig | null): string {
  const p = config?.period
  if (!p || (!p.from && !p.to)) return 'All time'
  return `${p.from ?? '…'} – ${p.to ?? '…'}`
}

function slugify(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48)
  return s || 'report'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405)

  const db = admin()

  // feature flag gates everything
  const { data: flag } = await db.from('feature_flags').select('is_enabled').eq('key', 'reporting').maybeSingle()
  if (!flag?.is_enabled) return json({ skipped: 'reporting flag is off' })

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }
  const runId = String(body.run_id ?? '')
  if (!runId) return json({ error: 'run_id is required' }, 400)

  // authN: shared secret (cron/schedule) OR a signed-in caller that owns the run
  const secret = env('HOOK_SECRET')
  const trusted = Boolean(secret && req.headers.get('x-hook-secret') === secret)
  let callerId: string | null = null
  if (!trusted) {
    const caller = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
      global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    })
    const { data: u } = await caller.auth.getUser()
    if (!u?.user) return json({ error: 'not signed in' }, 401)
    callerId = u.user.id
  }

  const { data: runData, error: runErr } = await db
    .from('report_runs')
    .select('id, status, format, run_as_owner, requested_by, attempts, params, requester:profiles!report_runs_requested_by_fkey(display_name), definition:report_definitions(data_source, config, name, slug)')
    .eq('id', runId)
    .single()
  if (runErr || !runData) return json({ error: 'run not found' }, 404)
  const run = runData as unknown as RunRow

  if (!trusted && callerId !== run.requested_by && callerId !== run.run_as_owner) {
    return json({ error: 'not your run' }, 403)
  }
  if (run.status === 'succeeded') return json({ ok: true, already: true, run_id: runId })

  const def = (Array.isArray(run.definition) ? run.definition[0] : run.definition) ?? null
  if (!def) return json({ error: 'run has no definition' }, 400)

  await db.from('report_runs')
    .update({ status: 'running', started_at: new Date().toISOString(), attempts: (run.attempts ?? 0) + 1 })
    .eq('id', runId)

  try {
    // the run's params (a schedule's filters_snapshot, or a dashboard's live
    // filters) WIN over the definition's static config — this was the v1 bug
    // where an "IT-only last-month" schedule silently sent everything
    const effectiveConfig = mergeRunParams(def.config ?? {}, (run as { params?: Record<string, unknown> }).params ?? {})

    // dashboard document export: config.sections (or a schedule's snapshot of
    // them) — run every widget query under the owner's RLS and render the
    // dashboard itself, not a record list
    const dashSections = parseSections(effectiveConfig as Record<string, unknown>)
    if (dashSections) {
      const compiled = compileSections(dashSections)
      const rendered: PdfSection[] = []
      for (const sec of compiled) {
        const { data: secData, error: secErr } = await db.rpc('report_fetch_rows', { p_run: runId, p_sql: sec.sql })
        if (secErr) throw new Error(`fetch rows (${sec.title}): ${secErr.message}`)
        rendered.push({ title: sec.title, kind: sec.kind, columns: sec.columns, rows: (secData ?? []) as Record<string, unknown>[] })
      }
      const totalRows = rendered.reduce((n, sec) => n + sec.rows.length, 0)

      const format = run.format || 'pdf'
      const { ext, contentType } = artifactMeta(format)
      let bytes: Uint8Array
      if (format === 'xlsx') {
        bytes = sectionsToXLSX(rendered)
      } else if (format === 'pdf') {
        const requester = (run as unknown as { requester?: { display_name?: string } | { display_name?: string }[] }).requester
        const runBy = Array.isArray(requester) ? requester[0]?.display_name : requester?.display_name
        bytes = await renderReportPdf(env, {
          title: def.name ?? 'Dashboard',
          subtitle: periodLabel(effectiveConfig),
          columns: [], rows: [],
          rowCountTotal: totalRows,
          sections: rendered,
          runBy,
        })
      } else {
        throw new Error('dashboard exports support pdf and xlsx only')
      }

      const path = `${run.run_as_owner}/${runId}/${slugify(def.name ?? 'dashboard')}.${ext}`
      const { error: upErr } = await db.storage.from('reports').upload(path, bytes, { contentType, upsert: true })
      if (upErr) throw new Error(`upload: ${upErr.message}`)
      const expiresIn = 3600
      const { data: signed } = await db.storage.from('reports').createSignedUrl(path, expiresIn)
      await db.from('report_runs').update({
        status: 'succeeded',
        row_count: totalRows,
        artifact_path: path,
        artifact_bytes: bytes.byteLength,
        signed_url_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
        finished_at: new Date().toISOString(),
      }).eq('id', runId)
      return json({ ok: true, run_id: runId, row_count: totalRows, download_url: signed?.signedUrl ?? null })
    }

    const { sql, columns } = compileQuery(def.data_source, effectiveConfig)

    const { data: rowData, error: fetchErr } = await db.rpc('report_fetch_rows', { p_run: runId, p_sql: sql })
    if (fetchErr) throw new Error(`fetch rows: ${fetchErr.message}`)
    const rows = (rowData ?? []) as Record<string, unknown>[]

    const format = run.format || 'csv'
    const { ext, contentType } = artifactMeta(format)
    let bytes: Uint8Array
    if (format === 'csv') {
      bytes = new TextEncoder().encode('\uFEFF' + toCSV(columns, rows)) // BOM so Excel reads UTF-8/Arabic
    } else if (format === 'xlsx') {
      bytes = toXLSX(columns, rows)
    } else if (format === 'pdf') {
      // per-report presentation: KPI band, chips, dept rails, tones, totals
      const pres = buildPresentation(def.slug, columns, rows)
      const requester = (run as unknown as { requester?: { display_name?: string } | { display_name?: string }[] }).requester
      const runBy = Array.isArray(requester) ? requester[0]?.display_name : requester?.display_name
      bytes = await renderReportPdf(env, {
        title: def.name ?? 'Report',
        subtitle: periodLabel(def.config),
        ...pres,
        runBy,
      })
    } else {
      throw new Error(`unsupported format: ${format}`)
    }

    const path = `${run.run_as_owner}/${runId}/${slugify(def.name ?? 'report')}.${ext}`
    const { error: upErr } = await db.storage.from('reports').upload(path, bytes, { contentType, upsert: true })
    if (upErr) throw new Error(`upload: ${upErr.message}`)

    const expiresIn = 3600
    const { data: signed } = await db.storage.from('reports').createSignedUrl(path, expiresIn)

    await db.from('report_runs').update({
      status: 'succeeded',
      row_count: rows.length,
      artifact_path: path,
      artifact_bytes: bytes.byteLength,
      signed_url_expires_at: new Date(Date.now() + expiresIn * 1000).toISOString(),
      finished_at: new Date().toISOString(),
      error: null,
    }).eq('id', runId)

    return json({
      ok: true,
      run_id: runId,
      row_count: rows.length,
      format,
      artifact_path: path,
      download_url: signed?.signedUrl ?? null,
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await db.from('report_runs')
      .update({ status: 'failed', error: msg.slice(0, 500), finished_at: new Date().toISOString() })
      .eq('id', runId)
    return json({ ok: false, run_id: runId, error: msg }, 500)
  }
})
