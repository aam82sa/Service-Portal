import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Donut, HBar } from '../../components/ui'
import type { Navigate } from '../../App'

interface Req {
  status: string
  dept: string
  assignee_id: string | null
  sla_resolution_due: string | null
  updated_at: string
}

interface Ev {
  area: string
  action: string
  detail: Record<string, string>
  created_at: string
  actor: { display_name: string } | null
}

const DAY = 24 * 3600 * 1000
const OPEN = (s: string) => !['closed', 'cancelled'].includes(s)
const STATUS_COLOR: Record<string, string> = {
  new: 'var(--it)', triaged: 'var(--admin)', in_progress: '#6E8FE0',
  pending_approval: 'var(--accent)', pending_requester: 'var(--amber)',
  escalated: 'var(--red)', resolved: 'var(--green)', closed: '#1E6B48', cancelled: '#CBD2DE',
}

function Kpi({ label, value, tone, sub, onClick }: {
  label: string; value: number; tone: string; sub?: string; onClick?: () => void
}) {
  return (
    <button
      className="card kpi-click"
      style={{ padding: '10px 14px', minWidth: 116, flex: 1, textAlign: 'left', cursor: 'pointer', position: 'relative', overflow: 'hidden' }}
      onClick={onClick}
    >
      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: tone }} />
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-head)', color: tone, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label} →</div>
      {sub && <div style={{ fontSize: 9.5, color: 'var(--muted)', opacity: 0.8 }}>{sub}</div>}
    </button>
  )
}

export function AdminOverview({ onNavigate }: { onNavigate: Navigate }) {
  const [reqs, setReqs] = useState<Req[]>([])
  const [assets, setAssets] = useState<{ status: string; category: string }[]>([])
  const [dels, setDels] = useState(0)
  const [licPending, setLicPending] = useState(0)
  const [licExpiring, setLicExpiring] = useState(0)
  const [flagsOff, setFlagsOff] = useState(0)
  const [users, setUsers] = useState(0)
  const [mailQueue, setMailQueue] = useState(0)
  const [events, setEvents] = useState<Ev[]>([])

  useEffect(() => {
    supabase.from('requests').select('status, dept, assignee_id, sla_resolution_due, updated_at')
      .then(({ data }) => setReqs((data as Req[]) ?? []))
    supabase.from('assets').select('status, category')
      .then(({ data }) => setAssets((data as { status: string; category: string }[]) ?? []))
    supabase.from('approval_delegations').select('status')
      .then(({ data }) => setDels(((data as { status: string }[]) ?? []).filter((x) => x.status === 'pending').length))
    supabase.from('licenses').select('status, expires_on').then(({ data }) => {
      const l = (data as { status: string; expires_on: string | null }[]) ?? []
      setLicPending(l.filter((x) => x.status === 'pending').length)
      setLicExpiring(l.filter((x) => x.status === 'active' && x.expires_on && new Date(x.expires_on).getTime() < Date.now() + 90 * DAY).length)
    })
    supabase.from('feature_flags').select('is_enabled')
      .then(({ data }) => setFlagsOff(((data as { is_enabled: boolean }[]) ?? []).filter((x) => !x.is_enabled).length))
    supabase.from('profiles').select('id', { count: 'exact', head: true })
      .then(({ count }) => setUsers(count ?? 0))
    supabase.from('notifications').select('status')
      .then(({ data }) => setMailQueue(((data as { status: string }[]) ?? []).filter((x) => x.status === 'pending').length))
    supabase.from('admin_events')
      .select('area, action, detail, created_at, actor:profiles(display_name)')
      .order('id', { ascending: false }).limit(7)
      .then(({ data }) => setEvents((data as unknown as Ev[]) ?? []))
  }, [])

  const open = reqs.filter((r) => OPEN(r.status))
  const unassigned = open.filter((r) => !r.assignee_id).length
  const breached = open.filter((r) => r.sla_resolution_due && new Date(r.sla_resolution_due).getTime() < Date.now()).length
  const statusCounts = reqs.reduce<Record<string, number>>((a, r) => { a[r.status] = (a[r.status] ?? 0) + 1; return a }, {})
  const catCounts = assets.reduce<Record<string, number>>((a, x) => { a[x.category] = (a[x.category] ?? 0) + 1; return a }, {})
  const maxCat = Math.max(1, ...Object.values(catCounts))
  const deptCounts = [['IT', open.filter((r) => r.dept === 'IT').length], ['ADMIN', open.filter((r) => r.dept === 'ADMIN').length]] as const
  const maxDept = Math.max(1, ...deptCounts.map(([, n]) => n))

  return (
    <>
      <h2 className="page-head">System overview</h2>
      <p className="page-sub">The platform at a glance — every tile drills into its data.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Kpi label="Users" value={users} tone="var(--ink)" onClick={() => onNavigate('admin', { admin: 'users' })} />
        <Kpi label="Open requests" value={open.length} tone="var(--it)" sub={`${unassigned} unassigned`} onClick={() => onNavigate('insights')} />
        <Kpi label="SLA breached" value={breached} tone={breached > 0 ? 'var(--red)' : 'var(--green)'} onClick={() => onNavigate('insights')} />
        <Kpi label="Assets" value={assets.length} tone="var(--it)" sub={`${assets.filter((a) => a.status === 'in_stock').length} in stock`} onClick={() => onNavigate('assets', { assetsTab: 'hardware' })} />
        <Kpi label="Delegations pending" value={dels} tone={dels > 0 ? 'var(--amber)' : 'var(--green)'} onClick={() => onNavigate('admin', { admin: 'delegation' })} />
        <Kpi label="Licenses pending" value={licPending} tone={licPending > 0 ? 'var(--amber)' : 'var(--green)'} onClick={() => onNavigate('assets', { assetsTab: 'licenses' })} />
        <Kpi label="Expiring 90d" value={licExpiring} tone={licExpiring > 0 ? 'var(--red)' : 'var(--green)'} onClick={() => onNavigate('assets', { assetsTab: 'licenses' })} />
        <Kpi label="Functions off" value={flagsOff} tone="var(--muted)" onClick={() => onNavigate('admin', { admin: 'functions' })} />
        <Kpi label="Emails queued" value={mailQueue} tone={mailQueue > 0 ? 'var(--amber)' : 'var(--green)'} sub="sends when M365 connects" onClick={() => onNavigate('admin', { admin: 'email' })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 10, marginBottom: 10 }}>
        <div className="card" style={{ padding: 12, cursor: 'pointer' }} onClick={() => onNavigate('insights')}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
            Requests by status →
          </div>
          <Donut
            parts={Object.entries(statusCounts).map(([s, v]) => ({ v, c: STATUS_COLOR[s] ?? 'var(--muted)' }))}
            centerTop={String(reqs.length)} centerSub="total"
          />
          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 6, justifyContent: 'center' }}>
            {Object.entries(statusCounts).slice(0, 6).map(([s, n]) => (
              <span key={s} style={{ fontSize: 9.5, color: 'var(--muted)', display: 'inline-flex', gap: 3, alignItems: 'center' }}>
                <span style={{ width: 7, height: 7, borderRadius: 2, background: STATUS_COLOR[s] ?? 'var(--muted)' }} />
                {s.replace('_', ' ')} {n}
              </span>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
            Open requests by department
          </div>
          {deptCounts.map(([d, n]) => (
            <HBar key={d} name={d === 'IT' ? 'IT Services' : 'Administration'} value={n} max={maxDept}
              color={d === 'IT' ? 'var(--it)' : 'var(--admin)'} onClick={() => onNavigate('insights')} />
          ))}
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '10px 0 8px' }}>
            Assets by category
          </div>
          {Object.entries(catCounts).map(([c, n]) => (
            <HBar key={c} name={c} value={n} max={maxCat} color="var(--admin)"
              onClick={() => onNavigate('assets', { assetsTab: 'hardware' })} />
          ))}
        </div>

        <div className="card" style={{ padding: 12 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 6 }}>
            Recent administrative activity
          </div>
          {events.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 6, padding: '2.5px 0', fontSize: 11 }}>
              <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 9 }}>{e.area}</span>
              <span style={{ flex: 1, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {e.action.replace(/_/g, ' ')}
                {e.detail.ref ? ` · ${e.detail.ref}` : e.detail.name ? ` · ${e.detail.name}` : e.detail.page ? ` · ${e.detail.page}` : ''}
              </span>
              <span style={{ color: 'var(--muted)', fontSize: 9.5, flexShrink: 0 }}>
                {new Date(e.created_at).toLocaleDateString()}
              </span>
            </div>
          ))}
          {events.length === 0 && <div className="row-desc">No activity yet.</div>}
        </div>
      </div>
    </>
  )
}
