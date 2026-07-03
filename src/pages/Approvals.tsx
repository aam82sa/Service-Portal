import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEPT_COLOR, type DeptCode } from '../lib/types'

interface ApprovalStep {
  id: string
  request_id: string
  step_order: number
  approver_hint: string | null
  decision: 'pending' | 'approved' | 'rejected' | 'info_requested'
  comment: string | null
}

interface PendingRequest {
  id: string
  ref: string
  title: string
  dept: DeptCode
  amount: number | null
  requester: { display_name: string } | null
  steps: ApprovalStep[]
}

function Chain({ steps }: { steps: ApprovalStep[] }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, flexWrap: 'wrap' }}>
      {steps.map((s, i) => {
        const done = s.decision === 'approved'
        const rejected = s.decision === 'rejected'
        const color = done ? 'var(--green)' : rejected ? 'var(--red)' : 'var(--muted)'
        const bg = done ? 'var(--green-soft)' : rejected ? 'var(--red-soft)' : 'var(--surface)'
        return (
          <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {i > 0 && <span style={{ width: 18, height: 2, background: 'var(--line)' }} />}
            <span
              className="chip"
              style={{ background: bg, color, display: 'inline-flex', gap: 5, alignItems: 'center' }}
            >
              <span
                style={{
                  width: 8, height: 8, borderRadius: '50%',
                  background: done ? 'var(--green)' : rejected ? 'var(--red)' : 'var(--amber)',
                }}
              />
              {s.step_order}. {s.approver_hint ?? 'Approver'}
              {done ? ' — approved' : rejected ? ' — rejected' : ''}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function Approvals() {
  const [items, setItems] = useState<PendingRequest[]>([])
  const [comments, setComments] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase
      .from('requests')
      .select(
        'id, ref, title, dept, amount, requester:profiles!requests_requester_id_fkey(display_name), steps:approvals(id, request_id, step_order, approver_hint, decision, comment)'
      )
      .eq('status', 'pending_approval')
      .order('created_at')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else {
          const rows = ((data as unknown as PendingRequest[]) ?? []).map((r) => ({
            ...r,
            steps: [...r.steps].sort((a, b) => a.step_order - b.step_order),
          }))
          setItems(rows)
        }
        setLoaded(true)
      })
  }, [])

  useEffect(load, [load])

  const decide = async (step: ApprovalStep, decision: 'approved' | 'rejected') => {
    setError(null)
    const { error: e } = await supabase.rpc('decide_approval', {
      p_approval: step.id,
      p_decision: decision,
      p_comment: comments[step.id] || null,
    })
    if (e) setError(e.message)
    load()
  }

  return (
    <>
      <h2 className="page-head">Approvals</h2>
      <p className="page-sub">
        Requests awaiting your decision. Steps are decided in order; amounts follow the DoA
        matrix (SAR).
      </p>
      {items.map((r) => {
        const c = DEPT_COLOR[r.dept]
        const current = r.steps.find((s) => s.decision === 'pending')
        return (
          <div className="card" key={r.id} style={{ marginBottom: 14, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 10 }}>
              <span
                style={{ width: 4, alignSelf: 'stretch', background: c.rail, borderRadius: 2 }}
              />
              <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink)' }}>
                {r.ref}
              </span>
              <div style={{ flex: 1 }}>
                <div className="row-title">{r.title}</div>
                <div className="row-desc">
                  {r.requester?.display_name ?? 'Unknown'} · {c.label}
                </div>
              </div>
              {r.amount != null && (
                <span className="mono" style={{ fontSize: 14, color: 'var(--ink)' }}>
                  {r.amount.toLocaleString()} SAR
                </span>
              )}
            </div>
            <Chain steps={r.steps} />
            {current && (
              <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Comment (optional)"
                  value={comments[current.id] ?? ''}
                  onChange={(e) =>
                    setComments((s) => ({ ...s, [current.id]: e.target.value }))
                  }
                />
                <button className="btn primary" onClick={() => decide(current, 'approved')}>
                  Approve step {current.step_order}
                </button>
                <button className="btn" onClick={() => decide(current, 'rejected')}>
                  Reject
                </button>
              </div>
            )}
          </div>
        )
      })}
      {loaded && items.length === 0 && !error && (
        <div className="card">
          <div className="row row-desc">Nothing awaiting approval.</div>
        </div>
      )}
      {!loaded && !error && <p className="page-sub">Loading…</p>}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
