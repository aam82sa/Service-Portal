/**
 * Template lookup + rendering for outbound notifications. Pure module — no
 * Deno APIs — so vitest covers it (render.test.ts).
 *
 * Lookup: notification_templates by event key with a department override
 * falling back to the platform default (docs/admin-console.md §2). A missing
 * template or one whose per-event switch is off means "skip silently" — the
 * caller logs a line and returns 200.
 */

export interface TemplateRow {
  key: string
  dept: string | null
  subject: string
  body_html: string
  is_active: boolean
}

export type TemplateVars = Record<string, string | number | null | undefined>

/**
 * The template that applies for an event in a department: the dept override
 * when one exists, else the platform default. Returns null (= skip) when
 * nothing is configured or the chosen template is disabled.
 */
export function pickTemplate(
  templates: TemplateRow[],
  event: string,
  dept: string | null,
): TemplateRow | null {
  const override = dept ? templates.find((t) => t.key === event && t.dept === dept) : undefined
  const chosen = override ?? templates.find((t) => t.key === event && t.dept === null) ?? null
  if (!chosen || !chosen.is_active) return null
  return chosen
}

/** Replace {{placeholder}} tokens; unknown/missing values render as ''. */
export function renderTemplate(
  template: Pick<TemplateRow, 'subject' | 'body_html'>,
  vars: TemplateVars,
): { subject: string; html: string } {
  const sub = (s: string) =>
    s.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => {
      const v = vars[k]
      return v == null ? '' : String(v)
    })
  return { subject: sub(template.subject), html: sub(template.body_html) }
}

/** Standard variable bag for a request-shaped event payload. */
export function requestVars(record: {
  ref?: string | null
  title?: string | null
  status?: string | null
  amount?: number | null
  requester_name?: string | null
  service?: string | null
  sla_due?: string | null
}): TemplateVars {
  return {
    ref: record.ref,
    title: record.title,
    status: record.status ? String(record.status).replace(/_/g, ' ') : null,
    amount: record.amount != null ? Number(record.amount).toLocaleString('en-US') : null,
    requester_name: record.requester_name,
    service: record.service,
    sla_due: record.sla_due ? new Date(record.sla_due).toUTCString() : null,
  }
}
