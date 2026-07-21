import { describe, expect, it } from 'vitest'
import { diffChips, diffGraphs } from './workflowDiff'
import type { WorkflowGraph } from './workflowValidate'

const g = (over: Partial<WorkflowGraph> = {}): WorkflowGraph => ({
  steps: [
    { id: 'new', triggers: ['ack email'] },
    { id: 'in_progress', triggers: [] },
    { id: 'closed', triggers: [] },
  ],
  transitions: [
    { from: 'new', to: 'in_progress' },
    { from: 'in_progress', to: 'closed' },
  ],
  ...over,
})

describe('diffGraphs', () => {
  it('is empty when the graphs match', () => {
    const d = diffGraphs(g(), g())
    expect(d.empty).toBe(true)
    expect(diffChips(d)).toEqual([])
  })

  it('reports added and removed transitions', () => {
    const draft = g({
      transitions: [
        { from: 'new', to: 'in_progress' },
        { from: 'new', to: 'closed' }, // added
        // in_progress→closed removed
      ],
    })
    const d = diffGraphs(g(), draft)
    expect(d.addedTransitions).toEqual([{ from: 'new', to: 'closed' }])
    expect(d.removedTransitions).toEqual([{ from: 'in_progress', to: 'closed' }])
    expect(diffChips(d)).toEqual([
      ['+1 transition', 'add'],
      ['−1 transition', 'del'],
    ])
  })

  it('reports trigger changes per step', () => {
    const draft = g({
      steps: [
        { id: 'new', triggers: [] }, // ack email removed
        { id: 'in_progress', triggers: ['pause SLA'] }, // added
        { id: 'closed', triggers: [] },
      ],
    })
    const d = diffGraphs(g(), draft)
    expect(d.addedTriggers).toEqual([{ step: 'in_progress', key: 'pause SLA' }])
    expect(d.removedTriggers).toEqual([{ step: 'new', key: 'ack email' }])
  })

  it('reports requester-label changes', () => {
    const draft = g({
      steps: [
        { id: 'new', triggers: ['ack email'], label: 'Submitted' },
        { id: 'in_progress', triggers: [] },
        { id: 'closed', triggers: [] },
      ],
    })
    const d = diffGraphs(g(), draft)
    expect(d.labelChanges).toEqual(['new'])
    expect(d.empty).toBe(false)
  })

  it('treats a null published graph as everything-added', () => {
    const d = diffGraphs(null, g())
    expect(d.addedTransitions.length).toBe(2)
    expect(d.removedTransitions).toEqual([])
    expect(d.addedTriggers).toEqual([{ step: 'new', key: 'ack email' }])
  })
})
