import { describe, expect, it } from 'vitest'
import {
  offPathStates,
  previewConsequence,
  previewPath,
  requesterSequence,
  stepLabel,
} from './workflowPreview'
import { analyzeWorkflow, type WorkflowGraph, type WorkflowStatus } from './workflowValidate'

const STATUSES: WorkflowStatus[] = [
  'new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester',
  'escalated', 'resolved', 'closed', 'cancelled',
]

const graph = (over: Partial<WorkflowGraph> = {}): WorkflowGraph => ({
  steps: STATUSES.map((id) => ({ id, triggers: [] })),
  transitions: [
    { from: 'new', to: 'triaged' }, { from: 'new', to: 'cancelled' },
    { from: 'triaged', to: 'in_progress' },
    { from: 'in_progress', to: 'pending_approval' }, { from: 'in_progress', to: 'pending_requester' },
    { from: 'in_progress', to: 'resolved' }, { from: 'in_progress', to: 'escalated' },
    { from: 'pending_requester', to: 'in_progress' }, { from: 'pending_approval', to: 'in_progress' },
    { from: 'escalated', to: 'in_progress' },
    { from: 'resolved', to: 'closed' }, { from: 'resolved', to: 'in_progress' },
  ],
  ...over,
})

describe('previewPath', () => {
  it('finds the happy path through the default graph', () => {
    expect(previewPath(graph())).toEqual(['new', 'triaged', 'in_progress', 'resolved', 'closed'])
  })

  it('follows a shortened draft path', () => {
    const g = graph({
      transitions: [
        { from: 'new', to: 'in_progress' },
        { from: 'in_progress', to: 'resolved' },
        { from: 'resolved', to: 'closed' },
      ],
    })
    expect(previewPath(g)).toEqual(['new', 'in_progress', 'resolved', 'closed'])
  })

  it('falls back to the platform path when closed is unreachable', () => {
    const g = graph({ transitions: [{ from: 'new', to: 'triaged' }] })
    expect(previewPath(g)).toEqual(['new', 'triaged', 'in_progress', 'resolved', 'closed'])
  })
})

describe('stepLabel + requesterSequence', () => {
  it('gives the requester friendly defaults and the agent raw labels', () => {
    const g = graph()
    expect(stepLabel(g, 'new', 'agent')).toBe('New')
    expect(stepLabel(g, 'new', 'requester')).toBe('Submitted')
    expect(stepLabel(g, 'triaged', 'requester')).toBe('Being reviewed')
    expect(requesterSequence(g)).toBe('Submitted → Being reviewed → In progress → Done → Closed')
  })

  it('prefers the admin-set requester wording (steps[].label)', () => {
    const g = graph()
    g.steps = g.steps.map((s) => (s.id === 'pending_requester' ? { ...s, label: 'Waiting on you' } : s))
    expect(stepLabel(g, 'pending_requester', 'requester')).toBe('Waiting on you')
    expect(stepLabel(g, 'pending_requester', 'agent')).toBe('Pending requester')
  })
})

describe('offPathStates', () => {
  it('lists wired branch statuses with their tones', () => {
    const states = offPathStates(graph(), 'agent')
    expect(states.map((s) => s.id).sort()).toEqual(
      ['cancelled', 'escalated', 'pending_approval', 'pending_requester'],
    )
    expect(states.find((s) => s.id === 'pending_approval')?.tone).toBe('accent')
    expect(states.find((s) => s.id === 'escalated')?.tone).toBe('red')
  })

  it('omits branch statuses that are not wired into the graph', () => {
    const g = graph({
      transitions: [
        { from: 'new', to: 'in_progress' },
        { from: 'in_progress', to: 'resolved' },
        { from: 'resolved', to: 'closed' },
      ],
    })
    expect(offPathStates(g, 'agent')).toEqual([])
  })
})

describe('previewConsequence', () => {
  it('explains a dead end in requester words', () => {
    const g = graph({
      transitions: graph().transitions.filter((t) => t.from !== 'pending_requester'),
    })
    const issues = analyzeWorkflow(g)
    const line = previewConsequence(g, issues)
    expect(line).toContain('Pending requester')
    expect(line).toContain('Waiting for your reply')
    expect(line).toContain('forever')
  })

  it('is null when the graph has no dead end', () => {
    expect(previewConsequence(graph(), analyzeWorkflow(graph()))).toBeNull()
  })
})
