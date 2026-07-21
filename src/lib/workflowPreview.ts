/**
 * Preview-strip data for the workflow designer (WORKFL1 branch 6).
 *
 * Turns the DRAFT graph into what the request page will actually show:
 * the happy-path steps for the real LifecycleBar (BFS shortest path
 * new → closed, mirroring useLifecycle's happyPath), the off-path states
 * that render as banner chips, and a plain-language consequence line that
 * turns a rule violation into something a human understands.
 */
import type { WorkflowGraph, WorkflowIssue, WorkflowStatus } from './workflowValidate'

export type Audience = 'agent' | 'requester'

/** statuses that render as banners, not lifecycle steps (mirror useLifecycle) */
const BRANCH_STATUSES = new Set<string>(['pending_requester', 'escalated', 'cancelled', 'pending_approval'])

const AGENT_LABELS: Record<string, string> = {
  new: 'New', triaged: 'Triaged', in_progress: 'In progress',
  resolved: 'Resolved', closed: 'Closed',
}
const REQUESTER_LABELS: Record<string, string> = {
  new: 'Submitted', triaged: 'Being reviewed', in_progress: 'In progress',
  resolved: 'Done', closed: 'Closed',
  pending_requester: 'Waiting for your reply', pending_approval: 'Awaiting approval',
  escalated: 'Being escalated', cancelled: 'Cancelled',
}

const titleCase = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')

/** display wording for a step: the admin's requester label wins for requesters */
export function stepLabel(graph: WorkflowGraph, id: WorkflowStatus, audience: Audience): string {
  if (audience === 'requester') {
    const custom = graph.steps.find((s) => s.id === id)?.label
    return custom || REQUESTER_LABELS[id] || titleCase(id)
  }
  return AGENT_LABELS[id] || titleCase(id)
}

/** BFS shortest path new → closed through the draft transitions, skipping
 *  branch statuses — identical to the request page's happyPath. */
export function previewPath(graph: WorkflowGraph): WorkflowStatus[] {
  const adj = new Map<string, string[]>()
  for (const t of graph.transitions) {
    if (!adj.has(t.from)) adj.set(t.from, [])
    adj.get(t.from)!.push(t.to)
  }
  const prev = new Map<string, string>()
  const queue = ['new']
  const seen = new Set(['new'])
  while (queue.length) {
    const cur = queue.shift()!
    if (cur === 'closed') {
      const path = ['closed']
      let p = 'closed'
      while (prev.has(p)) { p = prev.get(p)!; path.unshift(p) }
      return path.filter((s) => s === 'new' || s === 'closed' || !BRANCH_STATUSES.has(s)) as WorkflowStatus[]
    }
    for (const nxt of adj.get(cur) ?? []) {
      if (seen.has(nxt) || (BRANCH_STATUSES.has(nxt) && nxt !== 'closed')) continue
      seen.add(nxt)
      prev.set(nxt, cur)
      queue.push(nxt)
    }
  }
  return ['new', 'triaged', 'in_progress', 'resolved', 'closed']
}

export type BannerTone = 'accent' | 'amber' | 'red' | 'muted'

export interface OffPathState {
  id: WorkflowStatus
  label: string
  tone: BannerTone
}

const BANNER_TONE: Record<string, BannerTone> = {
  pending_approval: 'accent', pending_requester: 'amber', escalated: 'red', cancelled: 'muted',
}

/** wired-in branch statuses shown as banner chips under the bar */
export function offPathStates(graph: WorkflowGraph, audience: Audience): OffPathState[] {
  const wired = (id: string) => graph.transitions.some((t) => t.from === id || t.to === id)
  return graph.steps
    .filter((s) => BRANCH_STATUSES.has(s.id) && wired(s.id))
    .map((s) => ({
      id: s.id,
      label: audience === 'requester' ? stepLabel(graph, s.id, 'requester') : titleCase(s.id),
      tone: BANNER_TONE[s.id] ?? 'muted',
    }))
}

/** the requester's reading of the whole path, for the caption */
export function requesterSequence(graph: WorkflowGraph): string {
  return previewPath(graph).map((id) => stepLabel(graph, id, 'requester')).join(' → ')
}

/**
 * Plain-language consequence of the first dead-end error, e.g. a request
 * parked in Pending requester showing "Waiting for your reply" forever.
 * Null when there is none.
 */
export function previewConsequence(graph: WorkflowGraph, issues: WorkflowIssue[]): string | null {
  const dead = issues.find((i) => i.severity === 'error' && i.nodeId && i.message.includes('dead end'))
  if (!dead?.nodeId) return null
  const requesterWord = stepLabel(graph, dead.nodeId, 'requester')
  return `With the draft as it stands, a request parked in ${titleCase(dead.nodeId)} would show “${requesterWord}” forever — the agent has no button to bring it back.`
}
