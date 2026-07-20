/**
 * Pure geometry for the workflow-designer canvas (WORKFL1 brief, branch 1).
 *
 * Turns a WorkflowGraph into node coordinates and SVG edge paths matching
 * prototype/workflow-designer-reference.html: a weighted "happy path" top lane
 * (New → Triaged → In progress → Resolved → Closed, solid dark edges), a
 * de-emphasised "side paths" lane (dashed, muted), and the approval loop drawn
 * in accent when the service requires approval. No React, no DOM — unit-tested.
 */
import type { WorkflowGraph, WorkflowStatus } from './workflowValidate'

export const NODE_W = 124
export const NODE_H = 52
const COL = 144 // x stride between columns
const LANE_Y = { happy: 44, side: 200, terminal: 340 } as const

export type Lane = keyof typeof LANE_Y
export type EdgeKind = 'happy' | 'approval' | 'side'

export interface NodeLayout {
  id: WorkflowStatus
  x: number
  y: number
  lane: Lane
  terminal: boolean
}

export interface EdgeLayout {
  from: WorkflowStatus
  to: WorkflowStatus
  d: string
  kind: EdgeKind
}

export interface WorkflowLayout {
  nodes: NodeLayout[]
  edges: EdgeLayout[]
  width: number
  height: number
}

/** Column order per lane; anything unknown is appended to the side lane. */
const HAPPY: WorkflowStatus[] = ['new', 'triaged', 'in_progress', 'resolved', 'closed']
const SIDE: WorkflowStatus[] = ['pending_requester', 'pending_approval', 'escalated']
const TERMINAL_ROW: WorkflowStatus[] = ['cancelled']
const TERMINAL = new Set<WorkflowStatus>(['closed', 'cancelled'])

function place(id: WorkflowStatus): { lane: Lane; col: number } {
  const h = HAPPY.indexOf(id)
  if (h >= 0) return { lane: 'happy', col: h }
  const t = TERMINAL_ROW.indexOf(id)
  if (t >= 0) return { lane: 'terminal', col: t }
  const s = SIDE.indexOf(id)
  return { lane: 'side', col: s >= 0 ? s : SIDE.length }
}

/** anchor points on a node box */
const anchors = (n: NodeLayout) => ({
  top: { x: n.x + NODE_W / 2, y: n.y },
  bottom: { x: n.x + NODE_W / 2, y: n.y + NODE_H },
  left: { x: n.x, y: n.y + NODE_H / 2 },
  right: { x: n.x + NODE_W, y: n.y + NODE_H / 2 },
})

function edgeKind(from: WorkflowStatus, to: WorkflowStatus, requiresApproval: boolean): EdgeKind {
  const hi = HAPPY.indexOf(from)
  const hj = HAPPY.indexOf(to)
  if (hi >= 0 && hj === hi + 1) return 'happy'
  const approvalPair =
    (from === 'in_progress' && to === 'pending_approval') ||
    (from === 'pending_approval' && to === 'in_progress')
  if (approvalPair && requiresApproval) return 'approval'
  return 'side'
}

/** Build an SVG path between two node boxes, choosing sensible anchors. */
function pathBetween(a: NodeLayout, b: NodeLayout, kind: EdgeKind): string {
  const A = anchors(a)
  const B = anchors(b)
  // same lane, left→right: straight horizontal segment (the happy path)
  if (a.lane === b.lane && b.x > a.x) {
    return `M${A.right.x},${A.right.y} L${B.left.x},${B.left.y}`
  }
  if (a.lane === b.lane && b.x < a.x) {
    return `M${A.left.x},${A.left.y} L${B.right.x},${B.right.y}`
  }
  // vertical-ish between lanes: bezier from the lower/upper anchor
  const down = b.y > a.y
  const start = down ? A.bottom : A.top
  const end = down ? B.top : B.bottom
  const midY = (start.y + end.y) / 2
  if (kind === 'approval') {
    // near-vertical, slight offset so the two directions don't overlap
    const dx = down ? -8 : 8
    return `M${start.x + dx},${start.y} L${end.x + dx},${end.y}`
  }
  return `M${start.x},${start.y} C${start.x},${midY} ${end.x},${midY} ${end.x},${end.y}`
}

export function layoutWorkflow(
  graph: WorkflowGraph,
  opts: { requiresApproval?: boolean } = {},
): WorkflowLayout {
  const requiresApproval = Boolean(opts.requiresApproval)
  const nodes: NodeLayout[] = graph.steps.map((s) => {
    const { lane, col } = place(s.id)
    return { id: s.id, lane, x: col * COL, y: LANE_Y[lane], terminal: TERMINAL.has(s.id) }
  })
  const byId = new Map(nodes.map((n) => [n.id, n]))

  const edges: EdgeLayout[] = []
  for (const t of graph.transitions) {
    const a = byId.get(t.from)
    const b = byId.get(t.to)
    if (!a || !b) continue
    const kind = edgeKind(t.from, t.to, requiresApproval)
    edges.push({ from: t.from, to: t.to, kind, d: pathBetween(a, b, kind) })
  }

  const maxCol = Math.max(0, ...nodes.map((n) => n.x)) + NODE_W
  const maxRow = Math.max(0, ...nodes.map((n) => n.y)) + NODE_H
  return { nodes, edges, width: Math.max(700, maxCol), height: Math.max(420, maxRow + 40) }
}
