/**
 * Pure helpers shared by the request-event dispatch and the durable outbox
 * drain. Kept side-effect-free so they can be unit-tested without a DB.
 */

/** request_events row → notification_templates key (null = not a mail event). */
export function eventKey(eventType: string, detail: Record<string, unknown>): string | null {
  switch (eventType) {
    case 'created': return 'request_created'
    case 'assigned': return 'assigned'
    case 'status_changed':
      if (detail.to === 'pending_approval') return 'pending_approval'
      if (detail.to === 'resolved') return 'resolved'
      return null
    case 'approval_decided':
      return detail.decision === 'approved' ? 'approved'
        : detail.decision === 'rejected' ? 'rejected' : null
    case 'sla_warning': return 'sla_warning'
    case 'sla_breached': return 'sla_breached'
    default: return null
  }
}

/**
 * Retry backoff for a failed outbox row, in minutes, keyed by attempt count.
 * 1 → 5 → 15 → 60 → 240; the SQL side (mark_email_result) mirrors this so the
 * schedule is authoritative in one place and documented/tested here.
 */
export function backoffMinutes(attempts: number): number {
  const schedule = [1, 5, 15, 60, 240]
  const i = Math.max(1, Math.floor(attempts)) - 1
  return schedule[Math.min(i, schedule.length - 1)]
}
