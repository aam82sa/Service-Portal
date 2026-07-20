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
export interface WorkflowStepDef {
  id: WorkflowStatus
  triggers: string[]
  /** requester-visible wording ("Waiting for your reply") — additive to the
   *  JSONB, ignored by the engine; the portal shows it instead of the raw key */
  label?: string
}
export interface WorkflowGraph { steps: WorkflowStepDef[]; transitions: WorkflowTransition[] }

/** Steps a request may legitimately stop at — no outgoing transition needed. */
const TERMINAL: WorkflowStatus[] = ['closed', 'cancelled']

export interface WorkflowValidateOpts {
  requiresApproval?: boolean
  /** service spawns child requests (mirrors migration 00052 parent auto-resolve) */
  spawnsChildren?: boolean
}

export type IssueSeverity = 'error' | 'warning'

export interface WorkflowIssue {
  severity: IssueSeverity
  message: string
  /** the step this issue is anchored to on the canvas, if any */
  nodeId?: WorkflowStatus
}

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

/** Steps that can still reach a terminal state (closed/cancelled). */
function canReachTerminal(graph: WorkflowGraph): Set<WorkflowStatus> {
  const ok = new Set<WorkflowStatus>(TERMINAL)
  let grew = true
  while (grew) {
    grew = false
    for (const t of graph.transitions) {
      if (ok.has(t.to) && !ok.has(t.from)) {
        ok.add(t.from)
        grew = true
      }
    }
  }
  return ok
}

/**
 * Full analysis of a workflow graph: errors (gate publish) and warnings
 * (advisory), each anchored to a node id where meaningful. Runs on every edit
 * in the designer; the string-only `validateWorkflow` is derived from it.
 */
export function analyzeWorkflow(graph: WorkflowGraph, opts: WorkflowValidateOpts = {}): WorkflowIssue[] {
  const out: WorkflowIssue[] = []
  const has = (from: WorkflowStatus, to: WorkflowStatus) =>
    graph.transitions.some((t) => t.from === from && t.to === to)

  if (!graph.transitions.some((t) => t.from === 'new')) {
    out.push({ severity: 'error', message: 'There is no transition out of New.', nodeId: 'new' })
  }

  const reachable = reachableFrom(graph)
  if (!reachable.has('closed')) {
    out.push({ severity: 'error', message: 'Closed is not reachable from New.', nodeId: 'closed' })
  }

  // a step wired into the graph that can never be entered is a silent trap
  for (const step of graph.steps) {
    if (step.id === 'new' || reachable.has(step.id)) continue
    const wired = graph.transitions.some((t) => t.from === step.id || t.to === step.id)
    if (wired) {
      out.push({ severity: 'error', message: `${label(step.id)} has transitions but is unreachable from New.`, nodeId: step.id })
    }
  }

  // a reachable non-terminal step with no way out strands requests
  const terminalReach = canReachTerminal(graph)
  for (const id of reachable) {
    if (TERMINAL.includes(id)) continue
    if (!graph.transitions.some((t) => t.from === id)) {
      out.push({ severity: 'error', message: `${label(id)} is a dead end — requests entering it can never leave.`, nodeId: id })
    } else if (!terminalReach.has(id)) {
      out.push({ severity: 'warning', message: `${label(id)} has no path to a terminal state.`, nodeId: id })
    }
  }

  if (opts.requiresApproval) {
    if (!has('in_progress', 'pending_approval') || !has('pending_approval', 'in_progress')) {
      out.push({ severity: 'error', message: 'This service requires approval — the Pending approval step cannot be removed.', nodeId: 'pending_approval' })
    }
  }

  if (opts.spawnsChildren && !has('in_progress', 'resolved')) {
    out.push({
      severity: 'error',
      message: 'Child-spawning services need an In progress → Resolved transition so the parent can auto-resolve when its children close.',
      nodeId: 'in_progress',
    })
  }

  return out
}

/**
 * Returns the list of guardrail violations (error messages only); an empty list
 * means the graph is publishable. Kept for callers/tests that want plain
 * strings — derived from analyzeWorkflow.
 */
export function validateWorkflow(graph: WorkflowGraph, opts: WorkflowValidateOpts = {}): string[] {
  return analyzeWorkflow(graph, opts).filter((i) => i.severity === 'error').map((i) => i.message)
}

const label = (s: WorkflowStatus) =>
  (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')
