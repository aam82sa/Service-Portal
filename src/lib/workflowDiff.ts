/**
 * Graph diff for the workflow designer's version bar (WORKFL1 branch 4).
 * Pure: compares a published graph against the draft and reports what changed,
 * driving the "+2 transitions · −1 trigger" chips and the green/red-ghost edge
 * styling on the canvas.
 */
import type { WorkflowGraph, WorkflowStatus, WorkflowTransition } from './workflowValidate'

export interface TriggerChange { step: WorkflowStatus; key: string }

export interface GraphDiff {
  addedTransitions: WorkflowTransition[]
  removedTransitions: WorkflowTransition[]
  addedTriggers: TriggerChange[]
  removedTriggers: TriggerChange[]
  /** steps whose requester wording changed */
  labelChanges: WorkflowStatus[]
  empty: boolean
}

const tKey = (t: WorkflowTransition) => `${t.from}→${t.to}`

export function diffGraphs(published: WorkflowGraph | null, draft: WorkflowGraph): GraphDiff {
  const base = published ?? { steps: [], transitions: [] }
  const baseT = new Set(base.transitions.map(tKey))
  const draftT = new Set(draft.transitions.map(tKey))

  const addedTransitions = draft.transitions.filter((t) => !baseT.has(tKey(t)))
  const removedTransitions = base.transitions.filter((t) => !draftT.has(tKey(t)))

  const baseSteps = new Map(base.steps.map((s) => [s.id, s]))
  const draftSteps = new Map(draft.steps.map((s) => [s.id, s]))
  const addedTriggers: TriggerChange[] = []
  const removedTriggers: TriggerChange[] = []
  const labelChanges: WorkflowStatus[] = []

  for (const [id, ds] of draftSteps) {
    const bs = baseSteps.get(id)
    for (const key of ds.triggers) {
      if (!bs?.triggers.includes(key)) addedTriggers.push({ step: id, key })
    }
    if ((bs?.label ?? '') !== (ds.label ?? '')) labelChanges.push(id)
  }
  for (const [id, bs] of baseSteps) {
    const ds = draftSteps.get(id)
    for (const key of bs.triggers) {
      if (!ds?.triggers.includes(key)) removedTriggers.push({ step: id, key })
    }
  }

  const empty =
    addedTransitions.length === 0 && removedTransitions.length === 0 &&
    addedTriggers.length === 0 && removedTriggers.length === 0 &&
    labelChanges.length === 0

  return { addedTransitions, removedTransitions, addedTriggers, removedTriggers, labelChanges, empty }
}

/**
 * The distinct `from` states of removed transitions — the steps an in-flight
 * request could be sitting on when its outgoing path is taken away. Drives the
 * Publish impact dialog (which in-flight requests to surface). Version pinning
 * (00077) means those requests actually finish on their pinned graph; the
 * dialog is the transparency step before the published rules change for NEW
 * requests.
 */
export function removedFromStates(d: GraphDiff): WorkflowStatus[] {
  return [...new Set(d.removedTransitions.map((t) => t.from))]
}

/** Compact chips for the version bar: [["+2 transitions","add"], ["−1 trigger","del"]] */
export function diffChips(d: GraphDiff): Array<[string, 'add' | 'del']> {
  const chips: Array<[string, 'add' | 'del']> = []
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`
  if (d.addedTransitions.length) chips.push([`+${plural(d.addedTransitions.length, 'transition')}`, 'add'])
  if (d.removedTransitions.length) chips.push([`−${plural(d.removedTransitions.length, 'transition')}`, 'del'])
  if (d.addedTriggers.length) chips.push([`+${plural(d.addedTriggers.length, 'trigger')}`, 'add'])
  if (d.removedTriggers.length) chips.push([`−${plural(d.removedTriggers.length, 'trigger')}`, 'del'])
  if (d.labelChanges.length) chips.push([`~${plural(d.labelChanges.length, 'label')}`, 'add'])
  return chips
}
