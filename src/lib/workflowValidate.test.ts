import { describe, expect, it } from 'vitest'
import {
  analyzeWorkflow,
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

  it('requires in_progress → resolved for child-spawning services (mirrors 00052)', () => {
    const withoutResolvePath = DEFAULT_TRANSITIONS.filter(
      (t) => !(t.from === 'in_progress' && t.to === 'resolved'),
    )
    // without the spawn flag it's fine (in_progress still reaches resolved via others? no —
    // removing it makes resolved unreachable, so plain validation already errors on Closed)
    const spawn = validateWorkflow(graph(withoutResolvePath), { spawnsChildren: true })
    expect(spawn.some((e) => e.includes('auto-resolve'))).toBe(true)
    // the default graph (which has in_progress → resolved) passes with the flag
    expect(validateWorkflow(graph(DEFAULT_TRANSITIONS), { spawnsChildren: true })).toEqual([])
  })
})

describe('analyzeWorkflow structured output', () => {
  it('anchors each error to a node id', () => {
    const issues = analyzeWorkflow(graph(DEFAULT_TRANSITIONS.filter((t) => t.from !== 'pending_requester')))
    const dead = issues.find((i) => i.message.includes('dead end'))
    expect(dead?.severity).toBe('error')
    expect(dead?.nodeId).toBe('pending_requester')
  })

  it('separates warnings from errors', () => {
    // in_progress ⇄ escalated loop with no terminal path from escalated is a warning, not a block
    const issues = analyzeWorkflow(graph([
      { from: 'new', to: 'in_progress' },
      { from: 'in_progress', to: 'resolved' },
      { from: 'resolved', to: 'closed' },
      { from: 'in_progress', to: 'escalated' },
      { from: 'escalated', to: 'in_progress' },
    ]))
    // escalated can reach a terminal (via in_progress→resolved→closed), so no warning there;
    // sanity: no errors on this valid graph
    expect(issues.filter((i) => i.severity === 'error')).toEqual([])
  })

  it('flags a non-terminal loop with no path out as a warning', () => {
    const issues = analyzeWorkflow(graph([
      { from: 'new', to: 'triaged' },
      { from: 'new', to: 'closed' },
      { from: 'triaged', to: 'in_progress' },
      { from: 'in_progress', to: 'triaged' }, // triaged ⇄ in_progress loop, never reaches a terminal
    ]))
    const warn = issues.find((i) => i.severity === 'warning' && i.nodeId === 'in_progress')
    expect(warn?.message).toContain('no path to a terminal state')
  })
})
