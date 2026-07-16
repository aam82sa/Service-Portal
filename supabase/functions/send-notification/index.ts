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
import type { MailProvider } from './providers/types.ts'
import { smtpProvider } from './providers/smtp.ts'
import { graphProvider, graphToken } from './providers/graph.ts'
import { eventKey } from './outbox.ts'

const env = (k: string) => Deno.env.get(k)

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

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

Deno.serve(async (httpReq) => {
  if (httpReq.method !== 'POST') return json({ error: 'POST only' }, 405)

  const secret = env('HOOK_SECRET')
  if (!secret || httpReq.headers.get('x-hook-secret') !== secret) {
    return json({ error: 'missing or invalid X-Hook-Secret' }, 401)
  }

  let body: Record<string, unknown>
  try {
    body = await httpReq.json()
  } catch {
    return json({ error: 'invalid JSON' }, 400)
  }

  const db = admin()

  // feature flag gates everything except the auth diagnostic
  const { data: flag } = await db.from('feature_flags').select('is_enabled').eq('key', 'email_notifications').single()
  const enabled = Boolean(flag?.is_enabled)

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
