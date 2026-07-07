import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import type { Navigate } from '../../App'

const DAY = 24 * 3600 * 1000

interface Ev {
  id: number
  area: string
  action: string
  detail: Record<string, unknown>
  created_at: string
  actor: { display_name: string } | null
}
interface Del {
  id: string
  status: string
  ends_on: string
  delegator: { display_name: string } | null
  delegate: { display_name: string } | null
}
interface Lic {
  id: string
  name: string
  status: string
  expires_on: string | null
  requester: { display_name: string } | null
}
interface Flag { key: string; name: string; is_enabled: boolean }

type EvType = 'role' | 'user' | 'deleg' | 'license' | 'setting'
const TYPE_CHIP: Record<EvType, { label: string; bg: string; fg: string }> = {
  role: { label: 'ROLE', bg: 'var(--admin-soft)', fg: 'var(--admin)' },
  user: { label: 'USER', bg: 'var(--it-soft)', fg: 'var(--it)' },
  deleg: { label: 'DELEG', bg: '#FBF3E4', fg: 'var(--amber)' },
  license: { label: 'LICENSE', bg: 'var(--green-soft)', fg: 'var(--green)' },
  setting: { label: 'SETTING', bg: 'var(--surface)', fg: 'var(--muted)' },
}
const FILTERS: { id: EvType | 'all'; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'role', label: 'Roles' }, { id: 'user', label: 'Users' },
  { id: 'deleg', label: 'Delegations' }, { id: 'license', label: 'Licenses' }, { id: 'setting', label: 'Settings' },
]

function evType(area: string): EvType {
  switch (area) {
    case 'roles': return 'role'
    case 'users': case 'containers': return 'user'
    case 'delegation': return 'deleg'
    case 'licenses': return 'license'
    default: return 'setting'
  }
}

const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const shortDate = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

function evTime(iso: string) {
  const d = new Date(iso)
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
  return d.toDateString() === new Date().toDateString() ? hm : `${shortDate(iso)} · ${hm}`
}

/** Plain sentence for a log row; the key noun is bold, value changes mono. */
function evSentence(e: Ev, names: Map<string, string>): ReactNode {
  const d = e.detail
  const who = (k: string) => names.get(str(d[k])) ?? 'a user'
  switch (`${e.area}:${e.action}`) {
    case 'roles:granted':
      return <><b>{str(d.role)}</b>{d.dept ? ` · ${str(d.dept)}` : ''} granted to {who('profile_id')}</>
    case 'roles:revoked':
      return <><b>{str(d.role)}</b>{d.dept ? ` · ${str(d.dept)}` : ''} revoked from {who('profile_id')}</>
    case 'users:created': return <><b>{str(d.upn) || str(d.name)}</b> created</>
    case 'users:disabled': return <><b>{str(d.upn) || str(d.name)}</b> <b>disabled</b></>
    case 'users:enabled': return <><b>{str(d.upn) || str(d.name)}</b> re-enabled</>
    case 'delegation:created':
      return <>Approvals delegated · <b>{str(d.delegator)}</b> → {str(d.delegate)} · {shortDate(str(d.starts_on))}–{shortDate(str(d.ends_on))}</>
    case 'delegation:approved': return <>Delegation <b>approved</b></>
    case 'delegation:rejected': return <>Delegation <b>rejected</b></>
    case 'licenses:requested': return <><b>{str(d.name)}</b> requested · {str(d.seats)} seats</>
    case 'licenses:approved': return <><b>{str(d.name)}</b> <b>approved</b></>
    case 'licenses:rejected': return <><b>{str(d.name)}</b> <b>rejected</b></>
    case 'feature_flags:updated':
      return <><b>{str(d.key)}</b> turned <span className="mono">{d.is_enabled ? 'on' : 'off'}</span></>
    case 'access:page_access_updated': return <>Page access for <b>{str(d.page)}</b> updated</>
    default: {
      const ref = str(d.ref) || str(d.name) || str(d.page) || str(d.key)
      return <>{e.area.replace(/_/g, ' ')} <b>{e.action.replace(/_/g, ' ')}</b>{ref ? ` · ${ref}` : ''}</>
    }
  }
}

const label10: React.CSSProperties = {
  fontSize: 10.5, fontWeight: 600, letterSpacing: '.6px', textTransform: 'uppercase', color: 'var(--muted)',
}
const cardHead: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '11px 16px',
  borderBottom: '1px solid #EDEFF4',
}
const linkStyle: React.CSSProperties = {
  background: 'none', border: 'none', padding: 0, cursor: 'pointer',
  color: 'var(--accent)', fontWeight: 600, fontSize: 11.5, fontFamily: 'var(--font-body)',
}

function Stat({ value, label, tone, suffix, onClick }: {
  value: number | string; label: string; tone: string; suffix?: string; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)' }}
    >
      <div style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 20, color: tone, lineHeight: 1.15 }}>
        {value}
        {suffix && <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{suffix}</span>}
      </div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px', color: 'var(--muted)' }}>{label}</div>
    </button>
  )
}

function HealthRow({ ok, text, detail, action }: {
  ok: boolean; text: ReactNode; detail?: string; action?: { label: string; go: () => void }
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '10px 16px', borderTop: '1px solid #EDEFF4', fontSize: 12.5 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: ok ? 'var(--green)' : 'var(--amber)', flexShrink: 0 }} />
      <span style={{ flex: 1, color: 'var(--ink)' }}>{text}</span>
      {detail && <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{detail}</span>}
      {action && <button style={linkStyle} onClick={action.go}>{action.label}</button>}
    </div>
  )
}

export function AdminOverview({ onNavigate }: { onNavigate: Navigate }) {
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([])
  const [dels, setDels] = useState<Del[]>([])
  const [lics, setLics] = useState<Lic[]>([])
  const [flags, setFlags] = useState<Flag[]>([])
  const [mail, setMail] = useState<{ status: string; created_at: string }[]>([])
  const [events, setEvents] = useState<Ev[]>([])
  const [filter, setFilter] = useState<EvType | 'all'>('all')
  const [fullLog, setFullLog] = useState(false)

  useEffect(() => {
    supabase.from('profiles').select('id, display_name')
      .then(({ data }) => setPeople((data as { id: string; display_name: string }[]) ?? []))
    supabase.from('approval_delegations')
      .select('id, status, ends_on, delegator:profiles!approval_delegations_delegator_id_fkey(display_name), delegate:profiles!approval_delegations_delegate_id_fkey(display_name)')
      .then(({ data }) => setDels((data as unknown as Del[]) ?? []))
    supabase.from('licenses')
      .select('id, name, status, expires_on, requester:profiles!licenses_requested_by_fkey(display_name)')
      .then(({ data }) => setLics((data as unknown as Lic[]) ?? []))
    supabase.from('feature_flags').select('key, name, is_enabled')
      .then(({ data }) => setFlags((data as Flag[]) ?? []))
    supabase.from('notifications').select('status, created_at')
      .then(({ data }) => setMail((data as { status: string; created_at: string }[]) ?? []))
  }, [])

  useEffect(() => {
    supabase.from('admin_events')
      .select('id, area, action, detail, created_at, actor:profiles(display_name)')
      .order('id', { ascending: false }).limit(fullLog ? 100 : 15)
      .then(({ data }) => setEvents((data as unknown as Ev[]) ?? []))
  }, [fullLog])

  const names = useMemo(() => new Map(people.map((p) => [p.id, p.display_name])), [people])
  const delsPending = dels.filter((d) => d.status === 'pending').length
  const licPending = lics.filter((l) => l.status === 'pending')
  const licExpiring = lics.filter((l) =>
    l.status === 'active' && l.expires_on && new Date(l.expires_on).getTime() < Date.now() + 90 * DAY).length
  const flagsOn = flags.filter((f) => f.is_enabled)
  const firstOff = flags.find((f) => !f.is_enabled)
  const queued = mail.filter((m) => m.status === 'pending')
  const oldestQueued = queued.reduce<number | null>((min, m) => {
    const t = new Date(m.created_at).getTime()
    return min === null || t < min ? t : min
  }, null)
  const oldestAge = oldestQueued === null ? '' :
    Date.now() - oldestQueued >= DAY ? `oldest ${Math.floor((Date.now() - oldestQueued) / DAY)}d`
      : `oldest ${Math.max(1, Math.floor((Date.now() - oldestQueued) / 3600000))}h`
  const expiringDels = dels.filter((d) => {
    const end = new Date(d.ends_on).getTime()
    return d.status === 'approved' && end >= Date.now() - DAY && end < Date.now() + 14 * DAY
  })
  const queue = licPending.length + expiringDels.length
  const visibleEvents = events.filter((e) => filter === 'all' || evType(e.area) === filter)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 14 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 21, fontWeight: 600 }}>System overview</h2>
          <p className="page-sub" style={{ margin: '2px 0 0' }}>
            Administration &amp; audit · {new Date().toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}
          </p>
        </div>
        <button className="btn" style={{ padding: '8px 14px', fontWeight: 600, fontSize: 12 }} onClick={() => onNavigate('admin', { admin: 'functions' })}>Manage functions</button>
        <button className="btn" style={{ padding: '8px 14px', fontWeight: 600, fontSize: 12 }} onClick={() => onNavigate('admin', { admin: 'delegation' })}>New delegation</button>
        <button className="btn primary" style={{ padding: '8px 14px', fontWeight: 600, fontSize: 12 }} onClick={() => onNavigate('admin', { admin: 'users' })}>+ Add user</button>
      </div>

      <div className="card" style={{ display: 'flex', alignItems: 'center', padding: '14px 20px', marginBottom: 14 }}>
        <Stat value={people.length} label="Users" tone="var(--ink)" onClick={() => onNavigate('admin', { admin: 'users' })} />
        <span style={{ width: 1, height: 30, background: '#EDEFF4', margin: '0 18px' }} />
        <Stat value={delsPending} label="Delegations pending" tone="var(--amber)" onClick={() => onNavigate('admin', { admin: 'delegation' })} />
        <span style={{ width: 1, height: 30, background: '#EDEFF4', margin: '0 18px' }} />
        <Stat value={licPending.length} label="Licenses pending" tone="var(--amber)" onClick={() => onNavigate('assets', { assetsTab: 'licenses' })} />
        <span style={{ width: 1, height: 30, background: '#EDEFF4', margin: '0 18px' }} />
        <Stat value={licExpiring} label="Expiring 90d" tone="var(--red)" onClick={() => onNavigate('assets', { assetsTab: 'licenses' })} />
        <span style={{ width: 1, height: 30, background: '#EDEFF4', margin: '0 18px' }} />
        <Stat value={flagsOn.length} suffix={`/${flags.length}`} label="Functions on" tone="var(--green)" onClick={() => onNavigate('admin', { admin: 'functions' })} />
        <span style={{ width: 1, height: 30, background: '#EDEFF4', margin: '0 18px' }} />
        <Stat value={queued.length} label="Emails queued" tone="var(--accent)" onClick={() => onNavigate('admin', { admin: 'email' })} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: queue > 0 ? '1.5fr 1fr' : '1fr', gap: 14, alignItems: 'stretch', marginBottom: 14 }}>
        {queue > 0 && (
          <div className="card">
            <div style={cardHead}>
              <span style={label10}>Needs your action · {queue}</span>
              <button style={linkStyle} onClick={() => onNavigate('approvals')}>Approvals →</button>
            </div>
            {licPending.map((l) => (
              <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: '1px solid #EDEFF4' }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>LIC-{l.id.slice(0, 4).toUpperCase()}</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
                  {l.name}{l.requester ? ` — ${l.requester.display_name}` : ''}
                </span>
                <button className="btn primary" style={{ padding: '4px 12px', fontSize: 11.5 }} onClick={() => onNavigate('assets', { assetsTab: 'licenses' })}>Review</button>
              </div>
            ))}
            {expiringDels.map((d) => (
              <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px', borderTop: '1px solid #EDEFF4' }}>
                <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>DEL-{d.id.slice(0, 4).toUpperCase()}</span>
                <span style={{ flex: 1, fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>
                  Delegation expiring {shortDate(d.ends_on)} · {d.delegator?.display_name ?? '—'} → {d.delegate?.display_name ?? '—'}
                </span>
                <button className="btn" style={{ padding: '4px 12px', fontSize: 11.5, color: 'var(--accent)', fontWeight: 600 }} onClick={() => onNavigate('admin', { admin: 'delegation' })}>Renew</button>
              </div>
            ))}
          </div>
        )}

        <div className="card">
          <div style={cardHead}>
            <span style={label10}>System health</span>
            <button style={linkStyle} onClick={() => onNavigate('admin', { admin: 'functions' })}>Admin console →</button>
          </div>
          <div style={{ borderTop: 'none' }}>
            <HealthRow
              ok={false}
              text="M365 tenant not connected"
              action={{ label: 'Connect', go: () => onNavigate('admin', { admin: 'email' }) }}
            />
            <HealthRow
              ok={queued.length === 0}
              text={queued.length > 0 ? `${queued.length} email${queued.length > 1 ? 's' : ''} held in queue` : 'Email queue clear'}
              detail={oldestAge || undefined}
            />
            <HealthRow
              ok={flagsOn.length === flags.length}
              text={`Functions ${flagsOn.length} of ${flags.length} on`}
              detail={firstOff ? `${firstOff.key} off` : 'all on'}
            />
          </div>
        </div>
      </div>

      <div className="card">
        <div style={cardHead}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span style={label10}>Audit log</span>
            <div style={{ display: 'flex', gap: 2 }}>
              {FILTERS.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setFilter(f.id)}
                  style={{
                    fontSize: 11, borderRadius: 99, padding: '4px 12px', border: 'none', cursor: 'pointer',
                    fontFamily: 'var(--font-body)', fontWeight: filter === f.id ? 600 : 500,
                    background: filter === f.id ? 'var(--ink)' : 'transparent',
                    color: filter === f.id ? '#fff' : 'var(--muted)',
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <button style={linkStyle} onClick={() => setFullLog((v) => !v)}>{fullLog ? 'Recent only' : 'Full log →'}</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '110px 100px 1fr 150px', gap: 10, padding: '8px 16px', borderBottom: '1px solid #EDEFF4' }}>
          {['Time', 'Type', 'Event', 'By'].map((h) => (
            <span key={h} style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', color: '#8FA0BE' }}>{h}</span>
          ))}
        </div>
        {visibleEvents.map((e) => {
          const t = TYPE_CHIP[evType(e.area)]
          return (
            <div key={e.id} style={{ display: 'grid', gridTemplateColumns: '110px 100px 1fr 150px', gap: 10, alignItems: 'center', padding: '10px 16px', borderTop: '1px solid #EDEFF4', fontSize: 13 }}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--muted)' }}>{evTime(e.created_at)}</span>
              <span>
                <span className="chip" style={{ fontSize: 10.5, fontWeight: 600, padding: '3px 8px', background: t.bg, color: t.fg }}>{t.label}</span>
              </span>
              <span style={{ color: 'var(--ink)', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                {evSentence(e, names)}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{e.actor?.display_name ?? 'System'}</span>
            </div>
          )
        })}
        {visibleEvents.length === 0 && (
          <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--muted)' }}>No audit events{filter !== 'all' ? ' of this type' : ''} yet.</div>
        )}
      </div>
    </>
  )
}
