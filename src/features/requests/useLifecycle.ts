import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import type { LifecycleBarProps, LifecycleStep } from '../../components/LifecycleBar'

/** Assembles LifecycleBar props from the request's pinned workflow graph,
 *  its approval chain and its event history. The component itself stays
 *  data-free; this hook owns all Supabase access. */

interface Transition { from: string; to: string }
interface Graph { transitions: Transition[] }

interface ReqRow {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  created_at: string
  sla_resolution_due: string | null
  service: { id: string; code: string; name: string; parent_id: string | null; requires_approval: boolean } | null
}
interface ApprovalRow {
  step_order: number
  approver_hint: string | null
  approver_role: string | null
  decision: string
  decided_at: string | null
}
interface EventRow {
  event_type: string
  detail: Record<string, unknown>
  created_at: string
  actor: { display_name: string } | null
}

// mirror of the engine's fallback in requests_guard_update (00010)
const DEFAULT_TRANSITIONS: Transition[] = [
  { from: 'new', to: 'triaged' }, { from: 'new', to: 'cancelled' },
  { from: 'triaged', to: 'in_progress' },
  { from: 'in_progress', to: 'pending_approval' }, { from: 'in_progress', to: 'pending_requester' },
  { from: 'in_progress', to: 'resolved' }, { from: 'in_progress', to: 'escalated' },
  { from: 'pending_requester', to: 'in_progress' }, { from: 'pending_approval', to: 'in_progress' },
  { from: 'escalated', to: 'in_progress' },
  { from: 'resolved', to: 'closed' }, { from: 'resolved', to: 'in_progress' },
]

const BRANCH_STATUSES = new Set(['pending_requester', 'escalated', 'cancelled', 'pending_approval'])
const LABELS: Record<string, string> = {
  new: 'Submitted', triaged: 'Triaged', in_progress: 'In progress',
  resolved: 'Resolved', closed: 'Closed',
}
const label = (s: string) => LABELS[s] ?? s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())

/** Shortest path through the workflow graph (BFS); branch statuses are not steps. */
function happyPath(transitions: Transition[]): string[] {
  const adj = new Map<string, string[]>()
  for (const t of transitions) {
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
      return path.filter((s) => s === 'new' || s === 'closed' || !BRANCH_STATUSES.has(s))
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

function fmtDuration(ms: number): string {
  const h = Math.floor(ms / 3600000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h >= 1) return `${h}h`
  return `${Math.max(1, Math.floor(ms / 60000))}m`
}

function assemble(req: ReqRow, approvals: ApprovalRow[], events: EventRow[], graph: Graph | null): LifecycleBarProps {
  const base = happyPath(graph?.transitions ?? DEFAULT_TRANSITIONS)

  // first arrival time + actor per status, from the event history
  const arrived = new Map<string, { at: string; actor?: string }>()
  for (const e of events) {
    if (e.event_type === 'created') {
      arrived.set('new', { at: e.created_at, actor: e.actor?.display_name })
    } else if (e.event_type === 'status_changed') {
      const to = String(e.detail.to ?? '')
      if (to && !arrived.has(to)) arrived.set(to, { at: e.created_at, actor: e.actor?.display_name })
    }
  }
  if (!arrived.has('new')) arrived.set('new', { at: req.created_at })

  const hasApprovals = approvals.length > 0 || Boolean(req.service?.requires_approval)
  const chainSorted = [...approvals].sort((a, b) => a.step_order - b.step_order)
  const chain: LifecycleStep[] = !hasApprovals ? [] :
    chainSorted.length === 0
      ? [{ key: 'approval', label: 'Approval' }]
      : chainSorted.length <= 3
        ? chainSorted.map((a) => ({
            key: `appr-${a.step_order}`,
            label: a.approver_hint ?? label(a.approver_role ?? 'Approver'),
            icon: a.approver_role === 'cybersecurity' ? ('shield' as const) : undefined,
            completedAt: a.decision === 'approved' ? a.decided_at ?? undefined : undefined,
          }))
        : [{
            key: 'approvals',
            label: `Approvals (${chainSorted.filter((a) => a.decision === 'approved').length} of ${chainSorted.length})`,
            completedAt: chainSorted.every((a) => a.decision === 'approved')
              ? chainSorted[chainSorted.length - 1].decided_at ?? undefined
              : undefined,
          }]

  // approval services: triage hands off to the chain, then implementation;
  // the pre-approval working stint is not its own milestone
  let keys: { key: string; label: string; icon?: LifecycleStep['icon'] }[]
  if (hasApprovals) {
    const tail = base.slice(base.indexOf('resolved') === -1 ? base.length - 1 : base.indexOf('resolved'))
    const head = base.filter((s) => !tail.includes(s) && s !== 'in_progress')
    keys = [
      ...head.map((s) => ({ key: s, label: label(s) })),
      ...chain,
      { key: 'implementation', label: 'Implementation' },
      ...tail.map((s) => ({ key: s, label: label(s) })),
    ]
  } else {
    keys = base.map((s) => ({ key: s, label: label(s) }))
  }

  const steps: LifecycleStep[] = keys.map((k) => ({ ...k }))
  const idxOf = (key: string) => steps.findIndex((s) => s.key === key)

  // current position on the happy path
  const allApproved = chainSorted.length > 0 && chainSorted.every((a) => a.decision === 'approved')
  const rejectedStep = chainSorted.find((a) => a.decision === 'rejected')
  const firstPending = chainSorted.find((a) => a.decision === 'pending')
  let currentIndex: number
  let state: LifecycleBarProps['state'] = 'normal'
  let stateNote: string | undefined

  const chainCurrent = () => {
    if (chainSorted.length === 0) return idxOf('approval')
    if (chainSorted.length > 3) return idxOf('approvals')
    if (firstPending) return idxOf(`appr-${firstPending.step_order}`)
    return idxOf(`appr-${chainSorted[chainSorted.length - 1].step_order}`)
  }

  const status = req.status
  if (idxOf(status) >= 0) {
    currentIndex = idxOf(status)
  } else if (status === 'pending_approval') {
    currentIndex = chainCurrent()
  } else if (['in_progress', 'pending_requester', 'escalated', 'cancelled'].includes(status)) {
    if (!hasApprovals) {
      currentIndex = idxOf('in_progress')
    } else if (rejectedStep) {
      currentIndex = chainSorted.length <= 3 ? idxOf(`appr-${rejectedStep.step_order}`) : idxOf('approvals')
      state = 'rejected'
      stateNote = 'Approval rejected — returned to the team'
    } else if (allApproved) {
      currentIndex = idxOf('implementation')
    } else {
      currentIndex = chainCurrent()
    }
  } else {
    // custom-workflow detour: append as current node, never crash
    steps.push({ key: status, label: label(status) })
    currentIndex = steps.length - 1
  }

  if (status === 'pending_requester') { state = 'pending_requester'; stateNote = stateNote ?? 'Paused until the requester replies' }
  if (status === 'escalated') { state = 'escalated'; stateNote = stateNote ?? 'SLA breached — escalated to the team lead' }
  if (status === 'cancelled') { state = 'rejected'; stateNote = 'Request cancelled' }

  // completion metadata: a step completes when the next milestone is reached
  const arrivalOf = (key: string): { at: string; actor?: string } | undefined => {
    if (key.startsWith('appr-')) {
      const a = chainSorted.find((x) => `appr-${x.step_order}` === key)
      return a?.decided_at ? { at: a.decided_at } : undefined
    }
    if (key === 'approval' || key === 'approvals') {
      const last = [...chainSorted].reverse().find((a) => a.decided_at)
      return last?.decided_at ? { at: last.decided_at } : arrived.get('pending_approval')
    }
    if (key === 'implementation') return arrived.get('resolved')
    return arrived.get(key)
  }
  steps.forEach((s, i) => {
    if (i >= currentIndex) return
    const next = steps[i + 1]
    const done = (next && arrivalOf(next.key)) ?? arrivalOf(s.key)
    if (s.completedAt === undefined && done) s.completedAt = done.at
    if (done?.actor) s.actor = done.actor
  })

  const enteredCurrent =
    arrived.get(status)?.at ?? arrived.get('pending_approval')?.at ?? req.created_at
  const timeInStep = fmtDuration(Date.now() - new Date(enteredCurrent).getTime())
  const done = ['resolved', 'closed'].includes(status)

  return {
    steps,
    currentIndex,
    state,
    stateNote,
    slaDue: done ? undefined : req.sla_resolution_due ?? undefined,
    slaStart: req.created_at,
    timeInStep: done ? undefined : timeInStep,
    color: DEPT_COLOR[req.dept].rail,
    soft: DEPT_COLOR[req.dept].soft,
  }
}

export function useLifecycle(requestId: string, refreshKey = 0): LifecycleBarProps | null {
  const [props, setProps] = useState<LifecycleBarProps | null>(null)

  useEffect(() => {
    let alive = true
    const run = async () => {
      const { data: req } = await supabase
        .from('requests')
        .select('id, ref, title, dept, status, created_at, sla_resolution_due, service:services(id, code, name, parent_id, requires_approval)')
        .eq('id', requestId)
        .single()
      if (!req || !alive) return
      const r = req as unknown as ReqRow
      const [{ data: appr }, { data: evs }, wf] = await Promise.all([
        supabase.from('approvals')
          .select('step_order, approver_hint, approver_role, decision, decided_at')
          .eq('request_id', requestId).eq('subject_type', 'request'),
        supabase.from('request_events')
          .select('event_type, detail, created_at, actor:profiles(display_name)')
          .eq('request_id', requestId).order('id'),
        (async (): Promise<Graph | null> => {
          if (!r.service) return null
          const fetchGraph = async (serviceId: string) => {
            const { data } = await supabase.from('workflow_definitions')
              .select('graph').eq('service_id', serviceId).eq('status', 'published')
              .order('version', { ascending: false }).limit(1)
            return (data?.[0]?.graph as Graph | undefined) ?? null
          }
          return (await fetchGraph(r.service.id))
            ?? (r.service.parent_id ? await fetchGraph(r.service.parent_id) : null)
        })(),
      ])
      if (!alive) return
      setProps(assemble(r, (appr as ApprovalRow[]) ?? [], (evs as unknown as EventRow[]) ?? [], wf))
    }
    run()

    // live advance when the request or its chain changes (no-op if Realtime
    // replication is not enabled for these tables)
    const channel = supabase
      .channel(`lifecycle-${requestId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'requests', filter: `id=eq.${requestId}` }, run)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approvals', filter: `request_id=eq.${requestId}` }, run)
      .subscribe()
    return () => { alive = false; supabase.removeChannel(channel) }
  }, [requestId, refreshKey])

  return props
}
