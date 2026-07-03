import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEPT_COLOR, type DeptCode } from '../lib/types'

interface Row {
  dept: DeptCode
  status: string
  priority: string
  created_at: string
  updated_at: string
  sla_resolution_due: string | null
}

interface Activity {
  event_type: string
  detail: Record<string, string>
  created_at: string
  request: { ref: string } | null
  actor: { display_name: string } | null
}

const OPEN = (r: Row) => !['closed', 'cancelled'].includes(r.status)

function Metric({ label, value, tone }: { label: string; value: number | string; tone?: string }) {
  return (
    <div className="card" style={{ padding: '14px 18px', flex: 1, minWidth: 130 }}>
      <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 26, fontFamily: 'var(--font-head)', color: tone ?? 'var(--ink)', marginTop: 2 }}>
        {value}
      </div>
    </div>
  )
}

export function Insights() {
  const [rows, setRows] = useState<Row[]>([])
  const [activity, setActivity] = useState<Activity[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('requests')
      .select('dept, status, priority, created_at, updated_at, sla_resolution_due')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows((data as Row[]) ?? [])
      })
    supabase
      .from('request_events')
      .select('event_type, detail, created_at, request:requests(ref), actor:profiles(display_name)')
      .order('id', { ascending: false })
      .limit(10)
      .then(({ data }) => setActivity((data as unknown as Activity[]) ?? []))
  }, [])

  const now = Date.now()
  const weekAgo = now - 7 * 24 * 3600 * 1000
  const open = rows.filter(OPEN)
  const breached = open.filter((r) => r.sla_resolution_due && new Date(r.sla_resolution_due).getTime() < now)
  const resolvedThisWeek = rows.filter(
    (r) => ['resolved', 'closed'].includes(r.status) && new Date(r.updated_at).getTime() >= weekAgo
  )
  const pendingApproval = open.filter((r) => r.status === 'pending_approval')

  const depts: DeptCode[] = ['IT', 'ADMIN', 'LOG']
  const maxDept = Math.max(1, ...depts.map((d) => open.filter((r) => r.dept === d).length))

  return (
    <>
      <h2 className="page-head">Insights</h2>
      <p className="page-sub">Live operational picture, scoped to what your role can see.</p>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Metric label="Open requests" value={open.length} />
        <Metric label="Resolved this week" value={resolvedThisWeek.length} tone="var(--green)" />
        <Metric label="Pending approval" value={pendingApproval.length} tone="var(--accent)" />
        <Metric label="SLA breached" value={breached.length} tone={breached.length > 0 ? 'var(--red)' : 'var(--green)'} />
      </div>

      <div style={{ display: 'flex', gap: 14, marginTop: 14, flexWrap: 'wrap' }}>
        <div className="card" style={{ padding: 18, flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 12 }}>
            Open requests by department
          </div>
          {depts.map((d) => {
            const c = DEPT_COLOR[d]
            const n = open.filter((r) => r.dept === d).length
            return (
              <div key={d} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '5px 0' }}>
                <span style={{ fontSize: 12, width: 100, color: 'var(--ink)' }}>{c.label}</span>
                <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 4, height: 14 }}>
                  <div
                    style={{
                      width: `${(n / maxDept) * 100}%`, minWidth: n > 0 ? 14 : 0,
                      background: c.rail, height: 14, borderRadius: 4,
                    }}
                  />
                </div>
                <span className="mono" style={{ fontSize: 12, width: 24, textAlign: 'right' }}>{n}</span>
              </div>
            )
          })}
          <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '16px 0 8px' }}>By status</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {Object.entries(
              open.reduce<Record<string, number>>((acc, r) => {
                acc[r.status] = (acc[r.status] ?? 0) + 1
                return acc
              }, {})
            ).map(([s, n]) => (
              <span key={s} className="chip" style={{ background: 'var(--surface)', color: 'var(--ink)' }}>
                {s.replace('_', ' ')} · {n}
              </span>
            ))}
            {open.length === 0 && <span className="row-desc">No open requests.</span>}
          </div>
        </div>

        <div className="card" style={{ padding: 18, flex: 1, minWidth: 280 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>Recent activity</div>
          {activity.map((a, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, padding: '5px 0', fontSize: 12.5 }}>
              <span className="mono" style={{ color: 'var(--accent)', flexShrink: 0 }}>
                {a.request?.ref ?? '—'}
              </span>
              <span style={{ color: 'var(--ink)', flex: 1 }}>
                {a.event_type === 'status_changed'
                  ? `${String(a.detail.from).replace('_', ' ')} → ${String(a.detail.to).replace('_', ' ')}`
                  : a.event_type.replace('_', ' ')}
                <span style={{ color: 'var(--muted)' }}> · {a.actor?.display_name ?? 'Staff'}</span>
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 11, flexShrink: 0 }}>
                {new Date(a.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
          {activity.length === 0 && <div className="row-desc">No activity yet.</div>}
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
