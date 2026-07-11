import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'

interface QueueRow {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  priority: string
  created_at: string
  sla_resolution_due: string | null
  sla_paused_at: string | null
  escalated_at: string | null
  assignee_id: string | null
  requester: { display_name: string } | null
  assignee: { display_name: string } | null
}

const NEXT_ACTIONS: Record<string, { label: string; to: string; primary?: boolean }[]> = {
  new: [{ label: 'Triage', to: 'triaged', primary: true }],
  triaged: [{ label: 'Start', to: 'in_progress', primary: true }],
  in_progress: [
    { label: 'Send for approval', to: 'pending_approval' },
    { label: 'Resolve', to: 'resolved', primary: true },
  ],
  resolved: [{ label: 'Close', to: 'closed', primary: true }],
}

export function SlaRing({ createdAt, due, pausedAt }: {
  createdAt: string
  due: string | null
  pausedAt?: string | null
}) {
  if (!due) return null
  // paused (pending requester): the clock freezes at the pause instant
  const ref = pausedAt ? new Date(pausedAt).getTime() : Date.now()
  const total = new Date(due).getTime() - new Date(createdAt).getTime()
  const left = new Date(due).getTime() - ref
  const frac = Math.max(0, Math.min(1, left / total))
  const color = pausedAt ? 'var(--muted)' : left <= 0 ? 'var(--red)' : frac < 0.2 ? 'var(--amber)' : 'var(--green)'
  const r = 9
  const circ = 2 * Math.PI * r
  const hoursLeft = Math.round(left / 3600000)
  return (
    <span
      title={pausedAt ? 'SLA paused — waiting on the requester' : left <= 0 ? 'SLA breached' : `${hoursLeft}h to SLA target`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
        <circle
          cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={pausedAt ? '2 3' : `${circ * frac} ${circ}`}
          strokeLinecap="round" transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="mono" style={{ fontSize: 10.5, color }}>
        {pausedAt ? 'paused' : left <= 0 ? 'breached' : `${hoursLeft}h`}
      </span>
    </span>
  )
}

export function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const { session } = useAuth()
  const [rows, setRows] = useState<QueueRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase
      .from('requests')
      .select(
        'id, ref, title, dept, status, priority, created_at, sla_resolution_due, sla_paused_at, escalated_at, assignee_id, requester:profiles!requests_requester_id_fkey(display_name), assignee:profiles!requests_assignee_id_fkey(display_name)'
      )
      .not('status', 'in', '(closed,cancelled)')
      .order('created_at')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows((data as unknown as QueueRow[]) ?? [])
        setLoaded(true)
      })
  }, [])

  useEffect(load, [load])

  const update = async (id: string, patch: Record<string, unknown>) => {
    setError(null)
    const { error: e } = await supabase.from('requests').update(patch).eq('id', id)
    if (e) setError(e.message)
    load()
  }

  return (
    <>
      <h2 className="page-head">Department queue</h2>
      <p className="page-sub">
        Open requests in your department. Transitions are validated and audit-logged by the
        database.
      </p>
      <div className="card">
        {rows.map((r) => {
          const c = DEPT_COLOR[r.dept]
          const actions = NEXT_ACTIONS[r.status] ?? []
          const mine = r.assignee_id === session!.user.id
          return (
            <div className="row" key={r.id}>
              <span
                style={{ width: 4, alignSelf: 'stretch', background: c.rail, borderRadius: 2 }}
              />
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink)', width: 84 }}>
                {r.ref}
              </span>
              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
                <div className="row-title">{r.title}</div>
                <div className="row-desc">
                  {r.requester?.display_name ?? 'Unknown'} ·{' '}
                  {r.assignee ? `assigned to ${r.assignee.display_name}` : 'unassigned'}
                </div>
              </div>
              <SlaRing createdAt={r.created_at} due={r.sla_resolution_due} pausedAt={r.sla_paused_at} />
              <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                {r.priority}
              </span>
              <span className="chip" style={{ background: c.soft, color: c.rail }}>
                {r.status.replace('_', ' ')}
              </span>
              {r.escalated_at && (
                <span className="chip" title="SLA breached — escalated per the escalation rules"
                  style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
                  escalated
                </span>
              )}
              {!r.assignee_id && (
                <button className="btn" onClick={() => update(r.id, { assignee_id: session!.user.id })}>
                  Assign to me
                </button>
              )}
              {(mine || !r.assignee_id) &&
                actions.map((a) => (
                  <button
                    key={a.to}
                    className={`btn${a.primary ? ' primary' : ''}`}
                    onClick={() => update(r.id, { status: a.to })}
                  >
                    {a.label}
                  </button>
                ))}
            </div>
          )
        })}
        {loaded && rows.length === 0 && !error && (
          <div className="row row-desc">The queue is clear.</div>
        )}
        {!loaded && !error && <div className="row row-desc">Loading queue…</div>}
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
