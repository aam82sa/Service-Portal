import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../lib/types'

interface RequestRow {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  priority: string
  created_at: string
}

const STATUS_CHIP: Record<string, { bg: string; fg: string }> = {
  new: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  triaged: { bg: 'var(--admin-soft)', fg: 'var(--admin)' },
  in_progress: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  pending_approval: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  pending_requester: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  escalated: { bg: 'var(--red-soft)', fg: 'var(--red)' },
  resolved: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  closed: { bg: 'var(--surface)', fg: 'var(--muted)' },
  cancelled: { bg: 'var(--surface)', fg: 'var(--muted)' },
}

export function MyRequests() {
  const { session } = useAuth()
  const [rows, setRows] = useState<RequestRow[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('requests')
      .select('id, ref, title, dept, status, priority, created_at')
      .eq('requester_id', session!.user.id)
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows((data as RequestRow[]) ?? [])
        setLoaded(true)
      })
  }, [session])

  return (
    <>
      <h2 className="page-head">My requests</h2>
      <p className="page-sub">Everything you have submitted, newest first.</p>
      <div className="card">
        {rows.map((r) => {
          const chip = STATUS_CHIP[r.status] ?? STATUS_CHIP.closed
          const c = DEPT_COLOR[r.dept]
          return (
            <div className="row" key={r.id}>
              <span
                style={{ width: 4, alignSelf: 'stretch', background: c.rail, borderRadius: 2 }}
              />
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink)', width: 86 }}>
                {r.ref}
              </span>
              <div style={{ flex: 1 }}>
                <div className="row-title">{r.title}</div>
                <div className="row-desc">
                  {new Date(r.created_at).toLocaleString()} · {c.label}
                </div>
              </div>
              <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                {r.priority}
              </span>
              <span className="chip" style={{ background: chip.bg, color: chip.fg }}>
                {r.status.replace('_', ' ')}
              </span>
            </div>
          )
        })}
        {loaded && rows.length === 0 && !error && (
          <div className="row row-desc">No requests yet — submit one from the portal.</div>
        )}
        {!loaded && !error && <div className="row row-desc">Loading…</div>}
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
