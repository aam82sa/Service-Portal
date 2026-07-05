import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface Counts {
  assetsTotal: number
  assetsInStock: number
  assetsRepair: number
  openRequests: number
  queueUnassigned: number
  pendingDelegations: number
  pendingLicenses: number
  expiringLicenses: number
  flagsOff: number
  users: number
  pendingNotifications: number
}

interface Ev {
  area: string
  action: string
  detail: Record<string, string>
  created_at: string
  actor: { display_name: string } | null
}

const DAY = 24 * 3600 * 1000

function Kpi({ label, value, tone, sub }: { label: string; value: number; tone: string; sub?: string }) {
  return (
    <div className="card" style={{ padding: '10px 14px', minWidth: 118, flex: 1 }}>
      <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-head)', color: tone, lineHeight: 1.1 }}>{value}</div>
      <div style={{ fontSize: 10, color: 'var(--muted)' }}>{label}</div>
      {sub && <div style={{ fontSize: 9.5, color: 'var(--muted)', opacity: 0.8 }}>{sub}</div>}
    </div>
  )
}

export function AdminOverview() {
  const [c, setC] = useState<Counts | null>(null)
  const [events, setEvents] = useState<Ev[]>([])

  useEffect(() => {
    ;(async () => {
      const [assets, reqs, dels, lics, flags, users, notifs] = await Promise.all([
        supabase.from('assets').select('status'),
        supabase.from('requests').select('status, assignee_id'),
        supabase.from('approval_delegations').select('status'),
        supabase.from('licenses').select('status, expires_on'),
        supabase.from('feature_flags').select('is_enabled'),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
        supabase.from('notifications').select('status'),
      ])
      const a = (assets.data as { status: string }[]) ?? []
      const r = (reqs.data as { status: string; assignee_id: string | null }[]) ?? []
      const open = r.filter((x) => !['closed', 'cancelled'].includes(x.status))
      const l = (lics.data as { status: string; expires_on: string | null }[]) ?? []
      setC({
        assetsTotal: a.length,
        assetsInStock: a.filter((x) => x.status === 'in_stock').length,
        assetsRepair: a.filter((x) => x.status === 'repair').length,
        openRequests: open.length,
        queueUnassigned: open.filter((x) => !x.assignee_id).length,
        pendingDelegations: ((dels.data as { status: string }[]) ?? []).filter((x) => x.status === 'pending').length,
        pendingLicenses: l.filter((x) => x.status === 'pending').length,
        expiringLicenses: l.filter(
          (x) => x.status === 'active' && x.expires_on && new Date(x.expires_on).getTime() < Date.now() + 90 * DAY
        ).length,
        flagsOff: ((flags.data as { is_enabled: boolean }[]) ?? []).filter((x) => !x.is_enabled).length,
        users: users.count ?? 0,
        pendingNotifications: ((notifs.data as { status: string }[]) ?? []).filter((x) => x.status === 'pending').length,
      })
      const { data: ev } = await supabase
        .from('admin_events')
        .select('area, action, detail, created_at, actor:profiles(display_name)')
        .order('id', { ascending: false })
        .limit(8)
      setEvents((ev as unknown as Ev[]) ?? [])
    })()
  }, [])

  if (!c) return <p className="page-sub">Loading system overview…</p>

  return (
    <>
      <h2 className="page-head">System overview</h2>
      <p className="page-sub">The platform at a glance — everything that concerns administrators.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
        <Kpi label="Users" value={c.users} tone="var(--ink)" />
        <Kpi label="Open requests" value={c.openRequests} tone="var(--it)" sub={`${c.queueUnassigned} unassigned`} />
        <Kpi label="Assets" value={c.assetsTotal} tone="var(--it)" sub={`${c.assetsInStock} in stock · ${c.assetsRepair} repair`} />
        <Kpi label="Delegations pending" value={c.pendingDelegations} tone={c.pendingDelegations > 0 ? 'var(--amber)' : 'var(--green)'} />
        <Kpi label="Licenses pending" value={c.pendingLicenses} tone={c.pendingLicenses > 0 ? 'var(--amber)' : 'var(--green)'} />
        <Kpi label="Licenses expiring 90d" value={c.expiringLicenses} tone={c.expiringLicenses > 0 ? 'var(--red)' : 'var(--green)'} />
        <Kpi label="Functions off" value={c.flagsOff} tone="var(--muted)" />
        <Kpi label="Emails queued" value={c.pendingNotifications} tone={c.pendingNotifications > 0 ? 'var(--amber)' : 'var(--green)'} sub="sends when M365 connects" />
      </div>

      <div className="card" style={{ padding: 14 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
          Recent administrative activity
        </div>
        {events.map((e, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, padding: '3px 0', fontSize: 12 }}>
            <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 9.5 }}>{e.area}</span>
            <span style={{ flex: 1 }}>
              {e.action.replace(/_/g, ' ')}
              {e.detail.ref ? ` · ${e.detail.ref}` : e.detail.name ? ` · ${e.detail.name}` : e.detail.page ? ` · ${e.detail.page}` : ''}
              <span style={{ color: 'var(--muted)' }}> — {e.actor?.display_name ?? 'system'}</span>
            </span>
            <span style={{ color: 'var(--muted)', fontSize: 10.5 }}>{new Date(e.created_at).toLocaleString()}</span>
          </div>
        ))}
        {events.length === 0 && <div className="row-desc">No administrative activity yet.</div>}
      </div>
    </>
  )
}
