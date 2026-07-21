import { describe, expect, it } from 'vitest'
import { layoutWorkflow, NODE_W } from './workflowLayout'
import type { WorkflowGraph } from './workflowValidate'

const graph: WorkflowGraph = {
  steps: [
    { id: 'new', triggers: [] },
    { id: 'triaged', triggers: [] },
    { id: 'in_progress', triggers: [] },
    { id: 'pending_approval', triggers: [] },
    { id: 'pending_requester', triggers: [] },
    { id: 'escalated', triggers: [] },
    { id: 'resolved', triggers: [] },
    { id: 'closed', triggers: [] },
    { id: 'cancelled', triggers: [] },
  ],
  transitions: [
    { from: 'new', to: 'triaged' },
    { from: 'triaged', to: 'in_progress' },
    { from: 'in_progress', to: 'resolved' },
    { from: 'resolved', to: 'closed' },
    { from: 'in_progress', to: 'pending_approval' },
    { from: 'pending_approval', to: 'in_progress' },
    { from: 'in_progress', to: 'pending_requester' },
    { from: 'in_progress', to: 'escalated' },
    { from: 'new', to: 'cancelled' },
  ],
}

describe('layoutWorkflow', () => {
  it('places the happy path on the top lane in order', () => {
    const { nodes } = layoutWorkflow(graph)
    const happy = nodes.filter((n) => n.lane === 'happy').sort((a, b) => a.x - b.x)
    expect(happy.map((n) => n.id)).toEqual(['new', 'triaged', 'in_progress', 'resolved', 'closed'])
    expect(happy.every((n) => n.y === 44)).toBe(true)
    // evenly strided columns
    expect(happy[1].x - happy[0].x).toBe(144)
  })

  it('puts side paths on the lower lane and cancelled on the terminal row', () => {
    const { nodes } = layoutWorkflow(graph)
    expect(nodes.find((n) => n.id === 'pending_requester')?.lane).toBe('side')
    expect(nodes.find((n) => n.id === 'escalated')?.y).toBe(200)
    expect(nodes.find((n) => n.id === 'cancelled')?.lane).toBe('terminal')
  })

  it('marks closed and cancelled as terminal', () => {
    const { nodes } = layoutWorkflow(graph)
    expect(nodes.find((n) => n.id === 'closed')?.terminal).toBe(true)
    expect(nodes.find((n) => n.id === 'cancelled')?.terminal).toBe(true)
    expect(nodes.find((n) => n.id === 'new')?.terminal).toBe(false)
  })

  it('classifies consecutive happy transitions as happy edges', () => {
    const { edges } = layoutWorkflow(graph)
    expect(edges.find((e) => e.from === 'new' && e.to === 'triaged')?.kind).toBe('happy')
    expect(edges.find((e) => e.from === 'resolved' && e.to === 'closed')?.kind).toBe('happy')
  })

  it('marks the approval pair as accent only when the service requires approval', () => {
    const off = layoutWorkflow(graph)
    expect(off.edges.find((e) => e.from === 'in_progress' && e.to === 'pending_approval')?.kind).toBe('side')
    const on = layoutWorkflow(graph, { requiresApproval: true })
    expect(on.edges.find((e) => e.from === 'in_progress' && e.to === 'pending_approval')?.kind).toBe('approval')
    expect(on.edges.find((e) => e.from === 'pending_approval' && e.to === 'in_progress')?.kind).toBe('approval')
  })

  it('emits a non-empty path for every transition and ignores danglers', () => {
    const { edges } = layoutWorkflow({
      steps: [{ id: 'new', triggers: [] }],
      transitions: [{ from: 'new', to: 'closed' }], // closed not in steps → dropped
    })
    expect(edges).toEqual([])
    const full = layoutWorkflow(graph)
    expect(full.edges.every((e) => e.d.startsWith('M'))).toBe(true)
    expect(full.edges.length).toBe(graph.transitions.length)
  })

  it('every happy node fits within the reported width', () => {
    const { nodes, width } = layoutWorkflow(graph)
    expect(nodes.every((n) => n.x + NODE_W <= width)).toBe(true)
  })

  it('marks draft-added transitions as added edges', () => {
    const { edges } = layoutWorkflow(graph, { added: new Set(['new→triaged']) })
    expect(edges.find((e) => e.from === 'new' && e.to === 'triaged')?.kind).toBe('added')
    // others keep their normal kind
    expect(edges.find((e) => e.from === 'triaged' && e.to === 'in_progress')?.kind).toBe('happy')
  })

  it('draws removed transitions as ghost edges alongside the draft', () => {
    const { edges } = layoutWorkflow(graph, { ghosts: [{ from: 'escalated', to: 'resolved' }] })
    const ghost = edges.find((e) => e.kind === 'removed')
    expect(ghost).toMatchObject({ from: 'escalated', to: 'resolved' })
    expect(ghost?.d.startsWith('M')).toBe(true)
    // the draft's own edges are all still present
    expect(edges.length).toBe(graph.transitions.length + 1)
  })

  it('gives every edge a midpoint inside the canvas', () => {
    const { edges, width, height } = layoutWorkflow(graph)
    for (const e of edges) {
      expect(e.mid.x).toBeGreaterThanOrEqual(0)
      expect(e.mid.x).toBeLessThanOrEqual(width)
      expect(e.mid.y).toBeGreaterThanOrEqual(0)
      expect(e.mid.y).toBeLessThanOrEqual(height)
    }
  })
})
