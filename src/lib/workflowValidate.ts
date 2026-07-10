/**
 * Publish guardrails for service workflow graphs — extracted from
 * WorkflowDesigner so the rules that gate `publish_workflow` are unit-tested.
 * The published graph is what the database enforces, so an invalid graph here
 * means requests that can never close or approvals that can be bypassed.
 */

export type WorkflowStatus =
  | 'new' | 'triaged' | 'in_progress' | 'pending_approval' | 'pending_requester'
  | 'escalated' | 'resolved' | 'closed' | 'cancelled'

export interface WorkflowTransition { from: WorkflowStatus; to: WorkflowStatus }
export interface WorkflowStepDef { id: WorkflowStatus; triggers: string[] }
export interface WorkflowGraph { steps: WorkflowStepDef[]; transitions: WorkflowTransition[] }

/** Steps a request may legitimately stop at — no outgoing transition needed. */
const TERMINAL: WorkflowStatus[] = ['closed', 'cancelled']

export function reachableFrom(graph: WorkflowGraph, start: WorkflowStatus = 'new'): Set<WorkflowStatus> {
  const reachable = new Set<WorkflowStatus>([start])
  let grew = true
  while (grew) {
    grew = false
    for (const t of graph.transitions) {
      if (reachable.has(t.from) && !reachable.has(t.to)) {
        reachable.add(t.to)
        grew = true
      }
    }
  }
  return reachable
}

/**
 * Returns the list of guardrail violations; an empty list means the graph is
 * publishable. Messages match what the designer shows inline.
 */
export function validateWorkflow(graph: WorkflowGraph, opts: { requiresApproval?: boolean } = {}): string[] {
  const errs: string[] = []
  const has = (from: WorkflowStatus, to: WorkflowStatus) =>
    graph.transitions.some((t) => t.from === from && t.to === to)

  if (!graph.transitions.some((t) => t.from === 'new')) {
    errs.push('There is no transition out of New.')
  }

  const reachable = reachableFrom(graph)
  if (!reachable.has('closed')) errs.push('Closed is not reachable from New.')

  // a step wired into the graph that can never be entered is a silent trap
  for (const step of graph.steps) {
    if (step.id === 'new' || reachable.has(step.id)) continue
    const wired = graph.transitions.some((t) => t.from === step.id || t.to === step.id)
    if (wired) errs.push(`${label(step.id)} has transitions but is unreachable from New.`)
  }

  // a reachable non-terminal step with no way out strands requests
  for (const id of reachable) {
    if (TERMINAL.includes(id)) continue
    if (!graph.transitions.some((t) => t.from === id)) {
      errs.push(`${label(id)} is a dead end — requests entering it can never leave.`)
    }
  }

  if (opts.requiresApproval) {
    if (!has('in_progress', 'pending_approval') || !has('pending_approval', 'in_progress')) {
      errs.push('This service requires approval — the Pending approval step cannot be removed.')
    }
  }

  return errs
}

const label = (s: WorkflowStatus) =>
  (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')
