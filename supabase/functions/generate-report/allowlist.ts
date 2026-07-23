/**
 * Per-data-source column ALLOWLIST. The compiler only ever emits SQL built
 * from these entries — a report definition can never reference a table or
 * column that isn't listed here, which is what makes "reports are config, not
 * SQL" safe against injection. The query still runs under the owner's RLS
 * (report_run_query), so this is the second of two independent guards.
 */

export type Agg = 'count' | 'sum' | 'avg' | 'min' | 'max'

export interface SourceSpec {
  /** FROM clause (a base table or an inline sub-select), already RLS-bound. */
  from: string
  /** allowed selectable columns → the SQL expression they compile to */
  columns: Record<string, string>
  /** columns that may appear in WHERE, with their type for value validation */
  filterable: Record<string, 'text' | 'number' | 'date' | 'ident'>
  /** columns that may appear in GROUP BY */
  groupable: string[]
  /** default column set when the definition names none */
  defaults: string[]
}

const requestCols: Record<string, string> = {
  ref: 'r.ref',
  title: 'r.title',
  dept: 'r.dept::text',
  status: 'r.status::text',
  priority: 'r.priority::text',
  amount: 'r.amount',
  created_at: 'r.created_at',
  updated_at: 'r.updated_at',
  resolved_at: 'r.resolved_at',
  closed_at: 'r.closed_at',
  rating: 'r.rating',
  sla_resolution_due: 'r.sla_resolution_due',
  age_days: "round(extract(epoch from (now() - r.created_at)) / 86400)::int",
  sla_met: "(r.sla_resolution_due is not null and r.updated_at <= r.sla_resolution_due)",
  breached: "(r.sla_resolution_due is not null and r.status not in ('resolved','closed','cancelled') and r.sla_resolution_due < now())",
}

export const SOURCES: Record<string, SourceSpec> = {
  requests: {
    from: 'requests r',
    columns: requestCols,
    filterable: { dept: 'ident', status: 'ident', priority: 'ident', created_at: 'date', amount: 'number' },
    groupable: ['dept', 'status', 'priority'],
    defaults: ['ref', 'title', 'dept', 'status', 'priority', 'created_at'],
  },
  // SLA reporting is the same base table, exposing the compliance-oriented columns
  sla: {
    from: 'requests r',
    columns: requestCols,
    filterable: { dept: 'ident', status: 'ident', priority: 'ident', created_at: 'date' },
    groupable: ['dept', 'status', 'priority'],
    defaults: ['ref', 'dept', 'priority', 'sla_resolution_due', 'sla_met', 'breached'],
  },
  assets: {
    from: 'assets a',
    columns: {
      tag: 'a.tag', category: 'a.category', model: 'a.model', serial: 'a.serial',
      status: 'a.status::text', assigned_to: 'a.assigned_to', assigned_name: 'a.assigned_name',
      location: 'a.location', manufacturer: 'a.manufacturer', vendor: 'a.vendor', cost: 'a.cost',
      purchased_on: 'a.purchased_on', warranty_end: 'a.warranty_end', created_at: 'a.created_at',
    },
    filterable: { category: 'ident', status: 'ident', cost: 'number', purchased_on: 'date' },
    groupable: ['category', 'status', 'location', 'manufacturer'],
    defaults: ['tag', 'category', 'model', 'status', 'assigned_name', 'location'],
  },
  letters: {
    from: 'letters l',
    columns: {
      ref_ours: 'l.ref_ours', direction: 'l.direction::text', subject: 'l.subject',
      dept: 'l.dept::text', status: 'l.status::text', confidentiality: 'l.confidentiality::text',
      letter_date: 'l.letter_date', received_on: 'l.received_on',
    },
    filterable: { direction: 'ident', dept: 'ident', status: 'ident', confidentiality: 'ident' },
    groupable: ['direction', 'dept', 'status', 'confidentiality'],
    defaults: ['ref_ours', 'direction', 'subject', 'dept', 'status'],
  },
  pmo_projects: {
    from: 'projects p',
    columns: {
      code: 'p.code', name: 'p.name', status: 'p.status::text',
      department_scope: 'p.department_scope::text', project_type: 'p.project_type::text',
      created_at: 'p.created_at',
    },
    filterable: { status: 'ident', department_scope: 'ident' },
    groupable: ['status', 'department_scope', 'project_type'],
    defaults: ['code', 'name', 'status', 'department_scope'],
  },
  // the PMI risk register — impact/score are stored generated columns, so the
  // heat-map maths is never re-derived downstream
  pmo_risks: {
    from: 'pmo_risks k join projects p on p.id = k.project_id',
    columns: {
      project_code: 'p.code', project_name: 'p.name',
      risk_ref: "('R-' || lpad(k.seq::text, 2, '0'))",
      title: 'k.title', category: 'k.category::text', type: 'k.type::text',
      probability: 'k.probability', impact: 'k.impact', score: 'k.score',
      response_strategy: 'k.response_strategy::text', status: 'k.status::text',
      contingency_amount: 'k.contingency_amount', next_review_date: 'k.next_review_date',
      created_at: 'k.created_at',
    },
    filterable: { category: 'ident', type: 'ident', status: 'ident', score: 'number', created_at: 'date' },
    groupable: ['category', 'type', 'status', 'project_code'],
    defaults: ['project_code', 'risk_ref', 'title', 'category', 'probability', 'impact', 'score', 'status'],
  },
  // the governance trail (admin_events); its own RLS keeps reads admin-gated
  audit: {
    from: 'admin_events e',
    columns: {
      area: 'e.area', action: 'e.action', actor_id: 'e.actor_id::text',
      detail: 'e.detail::text', created_at: 'e.created_at',
    },
    filterable: { area: 'ident', action: 'ident', created_at: 'date' },
    groupable: ['area', 'action'],
    defaults: ['created_at', 'area', 'action', 'detail'],
  },
}

/**
 * The two performance data sources are fixed aggregate shapes (not free column
 * pickers), so the compiler builds them wholesale; they still read `requests`
 * under the owner's RLS. employee_performance carries personal data and is
 * gated to dept scope + an extra role check on the definition (Branch 7).
 */
export const FIXED_SOURCES = new Set(['dept_performance', 'employee_performance'])

/**
 * The ONE canonical list of report data sources. The report_definitions CHECK
 * constraint (migration 00086) and this module must never diverge — the
 * parity test (allowlist.parity.test.ts) parses the migration and asserts
 * equality. pmo_evm was removed from the CHECK there: no tabular EVM source
 * exists (baselines are JSONB snapshots), so it could only ever produce a
 * guaranteed compile error.
 */
export const ALL_DATA_SOURCES: string[] = [...Object.keys(SOURCES), ...FIXED_SOURCES].sort()
