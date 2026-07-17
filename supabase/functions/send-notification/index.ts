/**
 * send-notification — outbound email dispatch for request/letter events.
 *
 * Durable path: a request_events INSERT enqueues an email_outbox row in the
 * same transaction (00066), then nudges {mode:'drain'} here; a pg_cron job
 * nudges every minute as a safety net. drain claims due rows, sends each, and
 * records the result with bounded retries + a dead-letter state, so a 5xx or
 * SMTP failure is retried instead of silently dropped. All posts carry the
 * shared-secret header `X-Hook-Secret` (secret: HOOK_SECRET); requests without
 * it are rejected. `letter_events` posts are accepted as a future route.
 *
 * Provider selection: EMAIL_PROVIDER = 'smtp' | 'graph' (default smtp; point
 * SMTP_* at the Mailtrap sandbox for testing). Diagnostics: {mode:'test-auth'}
 * checks Graph token acquisition; {mode:'send', to, subject, html} sends a
 * raw message through the active provider.
 *
 * The email_notifications feature flag is checked first — off = 200 skipped.
 */

import { createClient } from 'npm:@supabase/supabase-js@2'
import { pickTemplate, renderTemplate, requestVars, type TemplateRow } from './render.ts'
import type { MailAttachment, MailProvider } from './providers/types.ts'
import { smtpProvider } from './providers/smtp.ts'
import { graphProvider, graphToken } from './providers/graph.ts'
import { eventKey } from './outbox.ts'
import { deliveryMode, planRecipients, reportVars } from './reportDelivery.ts'

const env = (k: string) => Deno.env.get(k)

/** Browser calls require CORS: allow the app origin's preflight + headers. */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type, x-hook-secret',
  'access-control-allow-methods': 'POST, OPTIONS',
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } })

function provider(): MailProvider {
  return env('EMAIL_PROVIDER') === 'graph' ? graphProvider(env) : smtpProvider(env)
}

function admin() {
  return createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!)
}

interface RequestRow {
  id: string
  ref: string
  title: string
  dept: string
  status: string
  amount: number | null
  sla_resolution_due: string | null
  requester: { display_name: string; upn: string } | null
  assignee: { display_name: string; upn: string } | null
  service: { name: string } | null
}

async function roleEmails(db: ReturnType<typeof admin>, roles: string[], dept: string): Promise<string[]> {
  if (roles.length === 0) return []
  const { data } = await db
    .from('role_assignments')
    .select('role, dept, profile:profiles(upn, is_active)')
    .in('role', roles)
  const rows = (data ?? []) as unknown as { role: string; dept: string | null; profile: { upn: string; is_active: boolean } | null }[]
  return rows
    .filter((r) => (r.dept === null || r.dept === dept) && r.profile?.is_active)
    .map((r) => r.profile!.upn)
}

/** Recipient resolution per event (SPRINT1BRIEF §branch 3). */
async function resolveRecipients(
  db: ReturnType<typeof admin>,
  key: string,
  req: RequestRow,
  detail: Record<string, unknown>,
): Promise<string[]> {
  switch (key) {
    case 'request_created':
    case 'approved':
    case 'rejected':
    case 'resolved':
      return req.requester ? [req.requester.upn] : []
    case 'assigned':
      return req.assignee ? [req.assignee.upn] : []
    case 'pending_approval': {
      // the current (lowest pending) step decides who is on the hook
      const { data } = await db
        .from('approvals')
        .select('approver_role, step_order')
        .eq('request_id', req.id).eq('decision', 'pending')
        .order('step_order').limit(1)
      const role = (data?.[0]?.approver_role as string | null) ?? 'approver'
      return roleEmails(db, [role], req.dept)
    }
    case 'sla_warning':
    case 'sla_breached': {
      const roles = Array.isArray(detail.notify_roles) ? (detail.notify_roles as string[]) : []
      const out: string[] = []
      if (roles.includes('assignee') && req.assignee) out.push(req.assignee.upn)
      out.push(...await roleEmails(db, roles.filter((r) => r !== 'assignee'), req.dept))
      return out
    }
    default:
      return []
  }
}

interface EventRecord { request_id: string; event_type: string; detail?: Record<string, unknown> }
interface DeliveryResult { ok: boolean; skipped?: string; recipients?: string[]; error?: string; detail?: unknown }

/**
 * Deliver one request_events record: resolve template + recipients, render,
 * send. A missing template or empty recipient set is a terminal success
 * (ok: true, skipped) — there is nothing to retry. A provider failure is
 * ok: false so the outbox reschedules it.
 */
async function deliverEvent(db: ReturnType<typeof admin>, record: EventRecord): Promise<DeliveryResult> {
  const detail = record.detail ?? {}
  const key = eventKey(record.event_type, detail)
  if (!key) return { ok: true, skipped: `no mail event for ${record.event_type}` }

  const { data: reqRow, error: reqErr } = await db
    .from('requests')
    .select('id, ref, title, dept, status, amount, sla_resolution_due, requester:profiles!requests_requester_id_fkey(display_name, upn), assignee:profiles!requests_assignee_id_fkey(display_name, upn), service:services(name)')
    .eq('id', record.request_id)
    .single()
  if (reqErr || !reqRow) return { ok: false, error: `request not found: ${reqErr?.message}` }
  const req = reqRow as unknown as RequestRow

  const { data: templates } = await db
    .from('notification_templates')
    .select('key, dept, subject, body_html, is_active')
    .eq('key', key)
  const template = pickTemplate((templates ?? []) as TemplateRow[], key, req.dept)
  if (!template) return { ok: true, skipped: `no active template for ${key}` }

  const to = await resolveRecipients(db, key, req, detail)
  if (to.length === 0) return { ok: true, skipped: 'no recipients resolved' }

  const rendered = renderTemplate(template, requestVars({
    ref: req.ref, title: req.title, status: req.status, amount: req.amount,
    requester_name: req.requester?.display_name, service: req.service?.name,
    sla_due: req.sla_resolution_due,
  }))
  const result = await provider().send({ to, subject: rendered.subject, html: rendered.html })
  return { ok: result.ok, recipients: to, error: result.ok ? undefined : result.detail, detail: result }
}

interface OutboxRow { id: string; payload: EventRecord }

/** Drain the durable outbox: claim due rows, send each, record the result. */
async function drainOutbox(db: ReturnType<typeof admin>): Promise<{ claimed: number; sent: number; failed: number }> {
  const { data, error } = await db.rpc('claim_email_batch', { p_limit: 20 })
  if (error) throw new Error(`claim_email_batch: ${error.message}`)
  const rows = (data ?? []) as OutboxRow[]
  let sent = 0, failed = 0
  for (const row of rows) {
    let res: DeliveryResult
    try {
      res = await deliverEvent(db, row.payload)
    } catch (e) {
      res = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    await db.rpc('mark_email_result', {
      p_id: row.id, p_ok: res.ok,
      p_recipients: res.recipients ?? null,
      p_error: res.ok ? null : (res.error ?? 'send failed'),
      p_detail: res.detail ?? null,
    })
    if (res.ok) sent++; else failed++
  }
  return { claimed: rows.length, sent, failed }
}

// ---- report email-once (mode:'report') ----
const REPORT_CONTENT_TYPE: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}
function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'report'
}
function reportPeriodLabel(config: unknown): string {
  const p = (config as { period?: { from?: string; to?: string } } | null)?.period
  if (!p || (!p.from && !p.to)) return 'all time'
  return `${p.from ?? '…'} – ${p.to ?? '…'}`
}

interface ReportDef { name: string | null; contains_personal_data: boolean; config: unknown }
interface ReportRunRow {
  id: string
  status: string
  artifact_path: string | null
  format: string
  run_as_owner: string
  requested_by: string | null
  definition: ReportDef | ReportDef[] | null
}

/**
 * Email a finished report once. Internal recipients (active profiles) always
 * receive it; external addresses only when the requester holds the
 * report_external_delivery capability and the address is on the admin
 * allowlist. The artifact is attached when ≤ 8 MB, else a signed deep-link is
 * included. Every send is written to report_deliveries.
 */
async function deliverReport(
  db: ReturnType<typeof admin>,
  body: Record<string, unknown>,
  requesterId: string | null,
): Promise<Response> {
  const runId = String(body.run_id ?? '')
  if (!runId) return json({ error: 'run_id is required' }, 400)
  const recips = (body.recipients ?? {}) as { profile_ids?: string[]; external?: string[] }

  const { data: runData, error: runErr } = await db
    .from('report_runs')
    .select('id, status, artifact_path, format, run_as_owner, requested_by, definition:report_definitions(name, contains_personal_data, config)')
    .eq('id', runId)
    .single()
  if (runErr || !runData) return json({ error: 'run not found' }, 404)
  const run = runData as unknown as ReportRunRow
  if (run.status !== 'succeeded' || !run.artifact_path) return json({ error: 'report run is not ready' }, 409)

  const def = (Array.isArray(run.definition) ? run.definition[0] : run.definition) ?? null
  const requester = requesterId ?? run.requested_by

  // internal recipients → active profile UPNs
  const ids = Array.isArray(recips.profile_ids) ? recips.profile_ids : []
  let internal: string[] = []
  if (ids.length) {
    const { data: profs } = await db.from('profiles').select('upn, is_active').in('id', ids)
    internal = ((profs ?? []) as { upn: string | null; is_active: boolean }[])
      .filter((p) => p.is_active && p.upn).map((p) => p.upn as string)
  }

  // external gate: requester capability + admin allowlist
  const external = Array.isArray(recips.external) ? recips.external.map(String) : []
  let hasCapability = false
  let allowlist: string[] = []
  if (external.length) {
    if (requester) {
      const { data: cap } = await db.rpc('report_can_deliver_external', { p_profile: requester })
      hasCapability = Boolean(cap)
    }
    const { data: al } = await db.from('report_delivery_allowlist').select('email')
    allowlist = ((al ?? []) as { email: string }[]).map((r) => r.email)
  }

  const plan = planRecipients({ internal, external, allowlist, hasCapability })
  if (plan.accepted.length === 0) {
    return json({ ok: false, sent: 0, refused: plan.refused, skipped: 'no eligible recipients' })
  }

  const { data: templates } = await db.from('notification_templates')
    .select('key, dept, subject, body_html, is_active').eq('key', 'report_delivery')
  const template = pickTemplate((templates ?? []) as TemplateRow[], 'report_delivery', null)
  if (!template) return json({ error: 'report_delivery template is missing' }, 500)

  const { data: blob, error: dlErr } = await db.storage.from('reports').download(run.artifact_path)
  if (dlErr || !blob) return json({ error: `artifact download failed: ${dlErr?.message}` }, 500)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const mode = deliveryMode(bytes.byteLength)

  const { data: signed } = await db.storage.from('reports').createSignedUrl(run.artifact_path, 60 * 60 * 24)
  const link = signed?.signedUrl ?? null

  const rendered = renderTemplate(template, reportVars({
    report_name: def?.name ?? 'Report',
    period: reportPeriodLabel(def?.config),
    run_ref: runId.slice(0, 8),
    download_link: link,
  }))

  const format = run.format || 'pdf'
  const attachments: MailAttachment[] | undefined = mode === 'attach'
    ? [{ filename: `${slugify(def?.name ?? 'report')}.${format}`, content: bytes, contentType: REPORT_CONTENT_TYPE[format] ?? 'application/octet-stream' }]
    : undefined

  const result = await provider().send({ to: plan.accepted, subject: rendered.subject, html: rendered.html, attachments })

  await db.from('report_deliveries').insert({
    run_id: runId,
    channel: 'email',
    to: plan.accepted,
    contains_personal_data: Boolean(def?.contains_personal_data),
    external: plan.external.length > 0,
    status: result.ok ? 'sent' : 'failed',
    provider_detail: { mode, provider: result.provider, detail: result.detail ?? null, refused: plan.refused },
  })

  return json({ ok: result.ok, sent: plan.accepted.length, mode, external: plan.external, refused: plan.refused }, result.ok ? 200 : 502)
}

Deno.serve(async (httpReq) => {
  if (httpReq.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS })
  if (httpReq.method !== 'POST') return json({ error: 'POST only' }, 405)

  let body: Record<string, unknown>
  try {
    body = await httpReq.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const db = admin()
  const secret = env('HOOK_SECRET')
  const trusted = Boolean(secret && httpReq.headers.get('x-hook-secret') === secret)

  // feature flag gates everything except the auth diagnostic
  const { data: flag } = await db.from('feature_flags').select('is_enabled').eq('key', 'email_notifications').single()
  const enabled = Boolean(flag?.is_enabled)

  // ---- report email-once: allowed for a trusted server call OR a signed-in
  // caller (the requester); external delivery is gated per requester below ----
  if (body.mode === 'report') {
    if (!enabled) return json({ skipped: 'email_notifications flag is off' })
    let requesterId: string | null = null
    if (trusted) {
      requesterId = body.requested_by ? String(body.requested_by) : null
    } else {
      const caller = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
        global: { headers: { Authorization: httpReq.headers.get('Authorization') ?? '' } },
      })
      const { data: u } = await caller.auth.getUser()
      if (!u?.user) return json({ error: 'not signed in' }, 401)
      requesterId = u.user.id
    }
    return deliverReport(db, body, requesterId)
  }

  // ---- every other mode requires the shared secret ----
  if (!trusted) {
    return json({ error: 'missing or invalid X-Hook-Secret' }, 401)
  }

  // ---- durable outbox drain (pg_cron nudge / trigger nudge) ----
  if (body.mode === 'drain') {
    if (!enabled) return json({ skipped: 'email_notifications flag is off' })
    try {
      return json({ mode: 'drain', ...await drainOutbox(db) })
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 502)
    }
  }

  // ---- diagnostics ----
  if (body.mode === 'test-auth') {
    const t = await graphToken(env)
    return json({ mode: 'test-auth', ok: t.ok, detail: t.ok ? 'token acquired' : t.detail })
  }
  if (body.mode === 'send') {
    if (!enabled) return json({ skipped: 'email_notifications flag is off' })
    const result = await provider().send({
      to: [String(body.to ?? '')].filter(Boolean),
      subject: String(body.subject ?? 'Services Hub test'),
      html: String(body.html ?? '<p>Manual test from send-notification.</p>'),
    })
    return json(result, result.ok ? 200 : 502)
  }

  // ---- database webhook ----
  if (!enabled) return json({ skipped: 'email_notifications flag is off' })
  if (body.type !== 'INSERT') return json({ skipped: `ignoring ${body.type}` })

  if (body.table === 'letter_events') {
    // future letters route: accepted, templates not defined yet
    return json({ skipped: 'letter_events accepted — no templates configured yet' })
  }
  if (body.table !== 'request_events') return json({ skipped: `ignoring table ${body.table}` })

  // legacy per-event path (kept for manual/direct posts); the durable route is
  // enqueue-on-trigger + the drain mode above
  const record = body.record as EventRecord
  const res = await deliverEvent(db, record)
  if (res.skipped) return json({ skipped: res.skipped })
  return json({ recipients: res.recipients, ok: res.ok, detail: res.detail }, res.ok ? 200 : 502)
})
