import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { HomeProjects } from '../pmo/HomeProjects'
import { AdminOverview } from '../admin/AdminOverview'
import { DEPT_COLOR, type DeptCode, type Service } from '../../lib/types'
import type { Navigate } from '../../App'

/** Overview page — design 4a: dark hero band, urgent approval banner,
 *  MY PROJECTS + MY ASSETS cards, MY OPEN REQUESTS table. */

interface OwnReq {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  created_at: string
  updated_at: string
  sla_resolution_due: string | null
}
interface OwnAsset { tag: string; category: string; model: string | null; status: string }
interface OwnLic { name: string; expires_on: string | null }
interface Banner { id: string; title: string; severity: 'info' | 'warning' | 'critical'; starts_at: string }
interface PendingApproval { id: string; ref: string; title: string }
interface HeroService extends Service { sla_resolution_minutes: number | null }

const CLOSED = ['closed', 'cancelled']
const SEV_RANK = { critical: 0, warning: 1, info: 2 } as const

type Pill = 'popular' | DeptCode | 'pmo'
const PILLS: { key: Pill; label: string }[] = [
  { key: 'popular', label: 'Popular' },
  { key: 'IT', label: 'IT Services' },
  { key: 'ADMIN', label: 'Administration & Logistics' },
  { key: 'PROC', label: 'Procurement' },
  { key: 'pmo', label: 'Projects Management' },
]

const slaHint = (m: number | null) =>
  m == null ? null : m >= 1440 ? `${Math.round(m / 1440)}-day SLA` : `${Math.round(m / 60)}-hour SLA`

const STATUS_CHIP: Record<string, { bg: string; fg: string; label: string }> = {
  new: { bg: 'var(--it-soft)', fg: 'var(--it)', label: 'New' },
  triaged: { bg: 'var(--it-soft)', fg: 'var(--it)', label: 'Triaged' },
  in_progress: { bg: 'var(--amber-soft)', fg: 'var(--amber)', label: 'In progress' },
  pending_approval: { bg: 'var(--accent-soft)', fg: 'var(--accent)', label: 'Pending approval' },
  pending_requester: { bg: 'var(--amber-soft)', fg: 'var(--amber)', label: 'Waiting on you' },
  escalated: { bg: 'var(--red-soft)', fg: 'var(--red)', label: 'Escalated' },
  resolved: { bg: 'var(--green-soft)', fg: 'var(--green)', label: 'Resolved' },
}

export function Home({ onNavigate, onOpenRequest, onOpenProject }: {
  onNavigate: Navigate
  onOpenRequest: (id: string) => void
  onOpenProject?: (id: string) => void
}) {
  const { session, profile, hasRole } = useAuth()
  const isSys = hasRole('system_admin')
  const isApprover = hasRole('approver')
  const [reqs, setReqs] = useState<OwnReq[]>([])
  const [approvalsCount, setApprovalsCount] = useState(0)
  const [urgent, setUrgent] = useState<PendingApproval | null>(null)
  const [assets, setAssets] = useState<OwnAsset[]>([])
  const [lics, setLics] = useState<OwnLic[]>([])
  const [services, setServices] = useState<HeroService[]>([])
  const [notice, setNotice] = useState<Banner | null>(null)
  const [pill, setPill] = useState<Pill>('popular')
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (isSys || !session) return
    const uid = session.user.id
    supabase
      .from('requests')
      .select('id, ref, title, dept, status, created_at, updated_at, sla_resolution_due')
      .eq('requester_id', uid)
      .order('created_at', { ascending: false })
      .then(({ data }) => setReqs((data as OwnReq[]) ?? []))
    if (isApprover) {
      supabase
        .from('requests')
        .select('id, ref, title')
        .eq('status', 'pending_approval')
        .order('created_at')
        .then(({ data }) => {
          const rows = (data as PendingApproval[]) ?? []
          setApprovalsCount(rows.length)
          setUrgent(rows[0] ?? null)
        })
    }
    supabase
      .from('assets').select('tag, category, model, status').eq('assigned_to', uid)
      .then(({ data }) => setAssets((data as OwnAsset[]) ?? []))
    supabase
      .from('licenses')
      .select('name, expires_on, license_assignments!inner(profile_id)')
      .eq('license_assignments.profile_id', uid)
      .then(({ data }) => setLics((data as unknown as OwnLic[]) ?? []))
    supabase
      .from('services')
      .select('id, dept, code, name, description, sla_resolution_minutes')
      .eq('is_active', true)
      .order('dept')
      .then(({ data }) => setServices((data as HeroService[]) ?? []))
    supabase
      .from('feature_flags').select('is_enabled').eq('key', 'announcements').single()
      .then(({ data }) => {
        if (!data?.is_enabled) return
        supabase
          .from('announcements')
          .select('id, title, severity, starts_at, ends_at').eq('is_active', true)
          .lte('starts_at', new Date().toISOString())
          .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
          .then(({ data: anns }) => {
            const rows = (anns as Banner[]) ?? []
            rows.sort((a, b) =>
              (SEV_RANK[a.severity] ?? 3) - (SEV_RANK[b.severity] ?? 3) ||
              b.starts_at.localeCompare(a.starts_at))
            setNotice(rows[0] ?? null)
          })
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const tiles = useMemo(() => {
    let list = services
    if (pill !== 'popular' && pill !== 'pmo') list = list.filter((s) => s.dept === pill)
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((s) =>
        s.name.toLowerCase().includes(q) ||
        s.code.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q))
    }
    return list.slice(0, 4)
  }, [services, pill, query])

  if (isSys) return <AdminOverview onNavigate={onNavigate} />

  const firstName = profile?.display_name.split(' ')[0] ?? ''
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
  const open = reqs.filter((r) => !CLOSED.includes(r.status) && r.status !== 'resolved')
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const closedThisMonth = reqs.filter(
    (r) => CLOSED.includes(r.status) && new Date(r.updated_at) >= monthStart).length
  const tableRows = reqs.filter((r) => !CLOSED.includes(r.status)).slice(0, 6)
  const expiringLics = lics.filter(
    (l) => l.expires_on && new Date(l.expires_on).getTime() < Date.now() + 90 * 86400000).length

  const slaCell = (r: OwnReq) => {
    if (r.status === 'resolved' || !r.sla_resolution_due) return { text: '—', color: 'var(--muted)' }
    const ms = new Date(r.sla_resolution_due).getTime() - Date.now()
    if (ms <= 0) return { text: 'overdue', color: 'var(--red)' }
    const h = ms / 3600000
    const text = h >= 48 ? `${Math.round(h / 24)}d left` : `${Math.round(h)}h left`
    return { text, color: h < 4 ? 'var(--red)' : 'var(--green)' }
  }

  const heroChip = (label: string, n: number, color: string, go: () => void) => (
    <button onClick={go} style={{
      background: 'var(--ink-2)', border: 'none', borderRadius: 99, padding: '6px 14px',
      color: '#fff', fontSize: 11.5, cursor: 'pointer', fontFamily: 'var(--font-body)',
      display: 'inline-flex', gap: 6, alignItems: 'center',
    }}>
      <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, color }}>{n}</span> {label}
    </button>
  )

  const sectionLabel = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.6px', color: 'var(--muted)' } as const
  const allLink = (label: string, go: () => void) => (
    <button onClick={go} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11, fontWeight: 600, fontFamily: 'var(--font-body)' }}>
      {label}
    </button>
  )

  return (
    <>
      {/* A — dark hero band (bleeds to the content edges) */}
      <div style={{ background: 'var(--ink)', margin: '-16px -22px 18px', padding: '28px 32px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ fontSize: 22, fontWeight: 600, color: '#fff' }}>
              What do you need today, {firstName}?
            </h1>
            <div style={{ fontSize: 12, color: '#8FA0BE', marginTop: 4 }}>
              {today} · E-Services Portal{profile?.ad_department ? ` · ${profile.ad_department}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {heroChip('open', open.length, 'var(--amber)', () => onNavigate('requests'))}
            {isApprover && heroChip('to approve', approvalsCount, 'var(--accent)', () => onNavigate('approvals'))}
            {heroChip('closed this month', closedThisMonth, 'var(--green)', () => onNavigate('requests'))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 18, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onNavigate('portal')}
            placeholder="Search services — laptop, travel, purchase order…"
            style={{
              flex: 1, maxWidth: 520, background: 'var(--ink-2)', border: '1px solid var(--ink-3)',
              borderRadius: 10, padding: '11px 14px', color: '#fff', fontSize: 12.5,
              fontFamily: 'var(--font-body)', outline: 'none',
            }}
          />
          <button
            onClick={() => onNavigate('portal')}
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 10, padding: '11px 18px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
          >
            Search
          </button>
          {notice && (
            <div style={{
              marginLeft: 'auto', background: 'var(--ink-2)', border: '1px solid var(--ink-3)',
              borderLeft: '3px solid var(--amber)', borderRadius: 10, padding: '8px 14px',
              maxWidth: 360, display: 'flex', gap: 10, alignItems: 'center',
            }}>
              <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.5px', color: 'var(--amber)' }}>NOTICE</span>
              <span style={{ fontSize: 11.5, color: '#B9C2D6', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {notice.title}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          {PILLS.map((p) => (
            <button
              key={p.key}
              onClick={() => (p.key === 'pmo' ? onNavigate('pmo') : setPill(p.key))}
              style={{
                background: pill === p.key ? 'var(--ink-3)' : 'transparent',
                color: pill === p.key ? '#fff' : '#8FA0BE',
                border: 'none', borderRadius: 99, padding: '5px 14px',
                fontSize: 11.5, cursor: 'pointer', fontFamily: 'var(--font-body)',
              }}
            >
              {p.label}
            </button>
          ))}
          <button
            onClick={() => onNavigate('portal')}
            style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
          >
            All {services.length} services →
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginTop: 14 }}>
          {tiles.map((sv) => {
            const c = DEPT_COLOR[sv.dept]
            const hint = [sv.description, slaHint(sv.sla_resolution_minutes)].filter(Boolean).join(' · ')
            return (
              <button
                key={sv.id}
                onClick={() => onNavigate('portal')}
                style={{
                  background: '#fff', border: 'none', borderLeft: `4px solid ${c.rail}`,
                  borderRadius: 10, padding: '12px 14px', textAlign: 'left', cursor: 'pointer',
                  fontFamily: 'var(--font-body)',
                }}
              >
                <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="mono" style={{ fontSize: 11, background: c.soft, color: c.rail, borderRadius: 6, padding: '2px 6px' }}>
                    {sv.code.slice(0, 2).toUpperCase()}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{sv.name}</span>
                </span>
                <span style={{ display: 'block', fontSize: 10.5, color: 'var(--muted)', marginTop: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {hint || c.label}
                </span>
              </button>
            )
          })}
          {tiles.length === 0 && (
            <span style={{ fontSize: 11.5, color: '#8FA0BE', padding: '12px 0' }}>No services match.</span>
          )}
        </div>
      </div>

      {/* B — urgent approval banner */}
      {isApprover && urgent && (
        <div style={{
          background: 'var(--accent-soft)', border: '1px solid #F0D9CE', borderRadius: 12,
          padding: '11px 16px', display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14,
        }}>
          <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{urgent.ref}</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>
            {urgent.title} is waiting for your approval
            {approvalsCount > 1 ? ` — plus ${approvalsCount - 1} more` : ''}
          </span>
          <button
            onClick={() => onNavigate('approvals')}
            style={{ background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
          >
            Review now
          </button>
        </div>
      )}

      {/* C — MY PROJECTS + MY ASSETS */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, alignItems: 'stretch', marginBottom: 14 }}>
        {onOpenProject && <HomeProjects onOpen={onOpenProject} onAll={() => onNavigate('pmo')} />}
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
            <span style={sectionLabel}>MY ASSETS</span>
            <span style={{ flex: 1 }} />
            {allLink('All →', () => onNavigate('assets'))}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 18px' }}>
            {assets.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 10.5, background: 'var(--it-soft)', color: 'var(--it)', borderRadius: 5, padding: '2px 4px', width: 20, textAlign: 'center' }}>HW</span>
                <span style={{ fontSize: 12, flex: 1 }}>Devices</span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{assets.length}</span>
              </div>
            )}
            {lics.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="mono" style={{ fontSize: 10.5, background: 'var(--admin-soft)', color: 'var(--admin)', borderRadius: 5, padding: '2px 4px', width: 20, textAlign: 'center' }}>SW</span>
                <span style={{ fontSize: 12, flex: 1 }}>
                  Licenses{expiringLics > 0 && <span style={{ color: 'var(--red)', fontWeight: 500 }}> · {expiringLics} exp</span>}
                </span>
                <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{lics.length}</span>
              </div>
            )}
          </div>
          {assets.length === 0 && lics.length === 0 && (
            <div className="row-desc">Nothing assigned to you yet.</div>
          )}
          {assets.slice(0, 3).map((a) => (
            <div key={a.tag} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '4px 0', color: 'var(--ink)', borderTop: '1px solid #EDEFF4', marginTop: 4 }}>
              <span className="mono" style={{ color: 'var(--muted)', fontSize: 10.5 }}>{a.tag}</span>
              {a.model ?? a.category}
              {a.status === 'repair' && <span style={{ color: 'var(--amber)', fontSize: 10.5 }}>in repair</span>}
            </div>
          ))}
        </div>
      </div>

      {/* D — MY OPEN REQUESTS */}
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'center', padding: '12px 16px 8px' }}>
          <span style={sectionLabel}>MY OPEN REQUESTS</span>
          <span style={{ flex: 1 }} />
          {allLink('All requests →', () => onNavigate('requests'))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr 110px 120px 140px', padding: '0 16px 6px' }}>
          {['ID', 'Request', 'Department', 'SLA', 'Status'].map((h) => (
            <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: '#8FA0BE' }}>{h}</span>
          ))}
        </div>
        {tableRows.map((r) => {
          const sla = slaCell(r)
          const st = STATUS_CHIP[r.status] ?? { bg: 'var(--surface)', fg: 'var(--muted)', label: r.status.replace('_', ' ') }
          return (
            <div
              key={r.id}
              onClick={() => onOpenRequest(r.id)}
              style={{ display: 'grid', gridTemplateColumns: '90px 1fr 110px 120px 140px', alignItems: 'center', padding: '11px 16px', borderTop: '1px solid #EDEFF4', fontSize: 13, cursor: 'pointer' }}
            >
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{r.ref}</span>
              <span style={{ fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', paddingRight: 10 }}>{r.title}</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: DEPT_COLOR[r.dept]?.rail }}>{r.dept}</span>
              <span className="mono" style={{ fontSize: 11, color: sla.color }}>{sla.text}</span>
              <span><span className="chip" style={{ fontSize: 11, fontWeight: 500, background: st.bg, color: st.fg }}>{st.label}</span></span>
            </div>
          )
        })}
        {tableRows.length === 0 && (
          <div className="row-desc" style={{ padding: '12px 16px' }}>No open requests — start one from the tiles above.</div>
        )}
      </div>
    </>
  )
}
