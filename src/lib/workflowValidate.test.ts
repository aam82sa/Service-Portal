import { describe, expect, it } from 'vitest'
import {
  validateWorkflow,
  type WorkflowGraph,
  type WorkflowStatus,
  type WorkflowTransition,
} from './workflowValidate'

const STATUSES: WorkflowStatus[] = [
  'new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester',
  'escalated', 'resolved', 'closed', 'cancelled',
]

/** The platform default graph from the designer. */
const DEFAULT_TRANSITIONS: WorkflowTransition[] = [
  { from: 'new', to: 'triaged' }, { from: 'new', to: 'cancelled' },
  { from: 'triaged', to: 'in_progress' },
  { from: 'in_progress', to: 'pending_approval' }, { from: 'in_progress', to: 'pending_requester' },
  { from: 'in_progress', to: 'resolved' }, { from: 'in_progress', to: 'escalated' },
  { from: 'pending_requester', to: 'in_progress' }, { from: 'pending_approval', to: 'in_progress' },
  { from: 'escalated', to: 'in_progress' },
  { from: 'resolved', to: 'closed' }, { from: 'resolved', to: 'in_progress' },
]

const graph = (transitions: WorkflowTransition[]): WorkflowGraph => ({
  steps: STATUSES.map((id) => ({ id, triggers: [] })),
  transitions,
})

describe('workflow publish guardrails', () => {
  it('accepts the platform default graph', () => {
    expect(validateWorkflow(graph(DEFAULT_TRANSITIONS))).toEqual([])
    expect(validateWorkflow(graph(DEFAULT_TRANSITIONS), { requiresApproval: true })).toEqual([])
  })

  it('rejects a graph with no way out of New', () => {
    const errs = validateWorkflow(graph(DEFAULT_TRANSITIONS.filter((t) => t.from !== 'new')))
    expect(errs).toContain('There is no transition out of New.')
  })

  it('rejects a graph where Closed cannot be reached', () => {
    const errs = validateWorkflow(graph(DEFAULT_TRANSITIONS.filter((t) => t.to !== 'closed')))
    expect(errs).toContain('Closed is not reachable from New.')
  })

  it('flags a wired step that is unreachable from New', () => {
    // escalated only points at in_progress; nothing points at escalated
    const errs = validateWorkflow(
      graph(DEFAULT_TRANSITIONS.filter((t) => t.to !== 'escalated')),
    )
    expect(errs.some((e) => e.includes('Escalated') && e.includes('unreachable'))).toBe(true)
  })

  it('flags a reachable dead-end step', () => {
    // pending_requester loses its way back
    const errs = validateWorkflow(
      graph(DEFAULT_TRANSITIONS.filter((t) => t.from !== 'pending_requester')),
    )
    expect(errs.some((e) => e.includes('Pending requester') && e.includes('dead end'))).toBe(true)
  })

  it('protects the approval loop on approval-required services only', () => {
    const noApproval = DEFAULT_TRANSITIONS.filter(
      (t) => t.to !== 'pending_approval' && t.from !== 'pending_approval',
    )
    expect(
      validateWorkflow(graph(noApproval), { requiresApproval: true }),
    ).toContain('This service requires approval — the Pending approval step cannot be removed.')
    expect(validateWorkflow(graph(noApproval), { requiresApproval: false })).toEqual([])
  })

  it('does not report untouched steps that simply are not wired in', () => {
    // a minimal graph: new → resolved → closed; other steps have no transitions at all
    const errs = validateWorkflow(graph([
      { from: 'new', to: 'resolved' },
      { from: 'resolved', to: 'closed' },
    ]))
    expect(errs).toEqual([])
  })
})
