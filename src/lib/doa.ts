/**
 * DoA (delegation of authority) band resolution — the TypeScript mirror of
 * `generate_doa_chain` in migration 00038. Kept pure so the banding rules the
 * database enforces can be unit-tested:
 *
 * - a row matches when its dept/service filters accept the request and
 *   `min_amount <= amount < max_amount` (null max = no upper bound)
 * - the most specific matching rows win: service-level (2) over
 *   dept-level (1) over platform-wide (0) — never mixed
 * - a request with no amount raises no DoA chain at all (the call sites only
 *   invoke chain generation when a positive amount is present)
 */

export interface DoaRow {
  dept: string | null
  service_id: string | null
  min_amount: number
  max_amount: number | null
  step_order: number
  approver_role?: string | null
  approver_hint: string | null
}

export interface DoaSubject {
  dept: string
  serviceId: string
  amount: number | null | undefined
}

export interface Delegation {
  delegator_id: string
  delegate_id: string
  starts_on: string // ISO date
  ends_on: string // ISO date
  status: string // only 'approved' delegations substitute
}

const specificity = (r: DoaRow): number =>
  r.service_id !== null ? 2 : r.dept !== null ? 1 : 0

const matches = (r: DoaRow, s: DoaSubject): boolean => {
  const amount = s.amount ?? 0
  if (r.dept !== null && r.dept !== s.dept) return false
  if (r.service_id !== null && r.service_id !== s.serviceId) return false
  if (amount < r.min_amount) return false
  if (r.max_amount !== null && amount >= r.max_amount) return false
  return true
}

/** The winning band: matching rows at the highest specificity, in step order. */
export function resolveBand(rows: DoaRow[], subject: DoaSubject): DoaRow[] {
  const hits = rows.filter((r) => matches(r, subject))
  if (hits.length === 0) return []
  const top = Math.max(...hits.map(specificity))
  return hits
    .filter((r) => specificity(r) === top)
    .sort((a, b) => a.step_order - b.step_order)
}

/**
 * The approval chain a submission would create. Zero, negative or missing
 * amounts create no chain — DoA only governs spend.
 */
export function buildChain(rows: DoaRow[], subject: DoaSubject): DoaRow[] {
  if (subject.amount == null || subject.amount <= 0) return []
  return resolveBand(rows, subject)
}

/**
 * Delegation substitution: when the assigned approver has an approved,
 * currently-active delegation, the delegate acts in their place.
 */
export function substituteDelegate(
  approverId: string,
  delegations: Delegation[],
  at: Date = new Date(),
): string {
  const day = at.toISOString().slice(0, 10)
  const active = delegations.find(
    (d) =>
      d.delegator_id === approverId &&
      d.status === 'approved' &&
      d.starts_on <= day &&
      d.ends_on >= day,
  )
  return active ? active.delegate_id : approverId
}
