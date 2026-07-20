/**
 * Typed trigger catalog for the workflow designer (WORKFL1 branch 3).
 *
 * The graph JSONB stores triggers as plain strings (`steps[].triggers`), so the
 * `key` values here must stay byte-identical to what published graphs already
 * contain — this catalog only layers typed metadata (display label, description,
 * palette icon, canvas badge, step restrictions) over those keys.
 */
import type { WorkflowStatus } from './workflowValidate'

export interface TriggerDef {
  /** the string stored in steps[].triggers — never rename */
  key: string
  /** human label (palette + properties pane) */
  label: string
  /** one-line description under the toggle */
  sub: string
  /** compact palette icon text */
  ico: string
  /** compact canvas node badge */
  badge: string
  badgeCls?: 'act' | 'pos'
  /** steps this trigger is valid on; undefined = any step */
  only?: WorkflowStatus[]
}

export const TRIGGER_CATALOG: TriggerDef[] = [
  { key: 'ack email', label: 'Send email', sub: 'Notify the requester by email', ico: '@', badge: '@ ack email' },
  { key: 'DoA chain', label: 'Request approval', sub: 'Start the DoA chain', ico: 'DoA', badge: 'DoA chain', badgeCls: 'act' },
  { key: 'auto-assign', label: 'Assign', sub: 'Route to a team or agent', ico: 'As', badge: 'As assign' },
  { key: 'start SLA', label: 'Start SLA', sub: 'Response/resolution clocks start', ico: '▶', badge: '▶ SLA', badgeCls: 'pos' },
  { key: 'pause SLA', label: 'Pause SLA', sub: 'Clock stops while waiting', ico: '‖', badge: '‖ pause SLA' },
  { key: 'spawn children', label: 'Spawn children', sub: 'Only valid on In progress', ico: '⇥', badge: '⇥ spawn', badgeCls: 'act', only: ['in_progress'] },
  { key: 'notify team lead', label: 'Notify team lead', sub: 'Escalation notice to the lead', ico: '@', badge: '@ notify lead' },
  { key: 'CSAT survey', label: 'CSAT survey', sub: 'Satisfaction survey to the requester', ico: '%', badge: '% CSAT' },
]

const byKey = new Map(TRIGGER_CATALOG.map((t) => [t.key, t]))

export function triggerDef(key: string): TriggerDef | undefined {
  return byKey.get(key)
}

/** Whether a trigger may be enabled on a given step. Unknown keys are allowed
 *  anywhere (forward-compat with graphs authored elsewhere). */
export function triggerAllowedOn(key: string, step: WorkflowStatus): boolean {
  const def = byKey.get(key)
  if (!def?.only) return true
  return def.only.includes(step)
}

/** Canvas badge text for a stored trigger key (falls back to the raw key). */
export function triggerBadge(key: string): { text: string; cls?: 'act' | 'pos' } {
  const def = byKey.get(key)
  return def ? { text: def.badge, cls: def.badgeCls } : { text: key }
}
