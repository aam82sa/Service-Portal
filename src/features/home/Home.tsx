import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode, type Service } from '../../lib/types'
import { SEVERITY_STYLE } from '../admin/Announcements'
import { AdminOverview } from '../admin/AdminOverview'
import type { Navigate } from '../../App'

interface OwnReq {
  id: string
  dept: DeptCode
  status: string
  created_at: string
  updated_at: string
  sla_resolution_due: string | null
}

interface OwnAsset {
  tag: string
  category: string
  model: string | null
  status: string
}

interface OwnLic {
  name: string
  expires_on: string | null
}

interface Banner {
  id: string
  title: string
  body: string | null
  severity: keyof typeof SEVERITY_STYLE
}

interface OwnDelegation {
  id: string
  starts_on: string
  ends_on: string
  status: string
  delegate: { display_name: string } | null
}

const CLOSED = ['closed', 'cancelled']

export function Home({ onNavigate, onOpenRequest }: {
  onNavigate: Navigate
  onOpenRequest: (id: string) => void
}) {
  const { session, profile, hasRole } = useAuth()
  const isSys = hasRole('system_admin')
  const isStaff = hasRole('agent') || hasRole('team_lead') || hasRole('dept_admin')
  const isApprover = hasRole('approver')
  const [work, setWork] = useState({ mine: 0, unassigned: 0, approvals: 0 })
  const [reqs, setReqs] = useState<OwnReq[]>([])
  const [assets, setAssets] = useState<OwnAsset[]>([])
  const [lics, setLics] = useState<OwnLic[]>([])
  const [services, setServices] = useState<Service[]>([])
  const [banners, setBanners] = useState<Banner[]>([])
  const [delegations, setDelegations] = useState<OwnDelegation[]>([])
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([])
  const [dform, setDform] = useState({ delegate: '', starts: '', ends: '', reason: '' })
  const [dError, setDError] = useState<string | null>(null)

  const loadDelegations = () =>
    supabase
      .from('approval_delegations')
      .select('id, starts_on, ends_on, status, delegate:profiles!approval_delegations_delegate_id_fkey(display_name)')
      .eq('delegator_id', session!.user.id)
      .order('starts_on', { ascending: false })
      .limit(3)
      .then(({ data }) => setDelegations((data as unknown as OwnDelegation[]) ?? []))

  const requestDelegation = async () => {
    setDError(null)
    const { error: e } = await supabase.from('approval_delegations').insert({
      delegator_id: session!.user.id,
      delegate_id: dform.delegate,
      starts_on: dform.starts,
      ends_on: dform.ends,
      reason: dform.reason || null,
      created_by: session!.user.id,
    })
    if (e) setDError(e.message)
    else setDform({ delegate: '', starts: '', ends: '', reason: '' })
    loadDelegations()
  }

  useEffect(() => {
    if (isSys) return // system admins get the system overview instead
    const uid = session!.user.id
    supabase
      .from('requests')
      .select('id, dept, status, created_at, updated_at, sla_resolution_due')
      .eq('requester_id', uid)
      .then(({ data }) => setReqs((data as OwnReq[]) ?? []))
    if (isStaff || isApprover) {
      supabase
        .from('requests')
        .select('status, assignee_id, requester_id')
        .not('status', 'in', '(closed,cancelled)')
        .then(({ data }) => {
          const rows = (data as { status: string; assignee_id: string | null }[]) ?? []
          setWork({
            mine: rows.filter((r) => r.assignee_id === uid).length,
            unassigned: rows.filter((r) => !r.assignee_id).length,
            approvals: rows.filter((r) => r.status === 'pending_approval').length,
          })
        })
    }
    supabase
      .from('assets')
      .select('tag, category, model, status')
      .eq('assigned_to', uid)
      .then(({ data }) => setAssets((data as OwnAsset[]) ?? []))
    supabase
      .from('licenses')
      .select('name, expires_on, license_assignments!inner(profile_id)')
      .eq('license_assignments.profile_id', uid)
      .then(({ data }) => setLics((data as unknown as OwnLic[]) ?? []))
    supabase
      .from('services')
      .select('id, dept, code, name, description')
      .eq('is_active', true)
      .order('dept')
      .limit(4)
      .then(({ data }) => setServices((data as Service[]) ?? []))
    supabase
      .from('feature_flags')
      .select('is_enabled')
      .eq('key', 'announcements')
      .single()
      .then(({ data }) => {
        if (!data?.is_enabled) return
        supabase
          .from('announcements')
          .select('id, title, body, severity, starts_at, ends_at').eq('is_active', true)
          .lte('starts_at', new Date().toISOString())
          .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
          .then(({ data: anns }) => setBanners((anns as Banner[]) ?? []))
      })
    loadDelegations()
    supabase
      .from('profiles')
      .select('id, display_name')
      .eq('is_active', true)
      .neq('id', uid)
      .order('display_name')
      .then(({ data }) => setPeople((data as { id: string; display_name: string }[]) ?? []))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session])

  const hour = new Date().getHours()
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
  const firstName = profile?.display_name.split(' ')[0] ?? ''
  const today = new Date().toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })

  if (isSys) return <AdminOverview onNavigate={onNavigate} />

  const deptRow = (d: DeptCode) => {
    const mine = reqs.filter((r) => r.dept === d)
    const closed = mine.filter((r) => CLOSED.includes(r.status))
    const open = mine.filter((r) => !CLOSED.includes(r.status))
    const late = open.filter(
      (r) => r.sla_resolution_due && new Date(r.sla_resolution_due).getTime() < Date.now()
    )
    const days = closed
      .map((r) => (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 86400000)
    const avg = days.length > 0 ? (days.reduce((s, x) => s + x, 0) / days.length).toFixed(1) : null
    return { mine, closed, open, late, avg }
  }

  const cell = { padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 10 } as const
  const mv = { fontSize: 18, fontWeight: 700, lineHeight: 1, fontFamily: 'var(--font-head)' } as const
  const ms = { fontSize: 10, color: 'var(--muted)', marginTop: 3 } as const

  return (
    <>
      {banners.map((b) => {
        const s = SEVERITY_STYLE[b.severity] ?? SEVERITY_STYLE.info
        return (
          <div key={b.id} style={{ background: s.bg, color: s.fg, borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 13 }}>
            <span style={{ fontWeight: 500 }}>{b.title}</span>
            {b.body && <span> — {b.body}</span>}
          </div>
        )
      })}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2 className="page-head">{greet}, {firstName} — here's your overview</h2>
        <span className="chip" style={{ background: 'var(--card)', border: '1px solid var(--line)', color: 'var(--muted)', padding: '6px 14px' }}>
          {today}
        </span>
      </div>

      {(isStaff || isApprover) && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {isStaff && (
            <button className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 130, textAlign: 'left', cursor: 'pointer' }} onClick={() => onNavigate('mywork')}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-head)', color: 'var(--it)' }}>{work.mine}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Assigned to me →</div>
            </button>
          )}
          {isStaff && (
            <button className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 130, textAlign: 'left', cursor: 'pointer' }} onClick={() => onNavigate('queue')}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-head)', color: work.unassigned > 0 ? 'var(--amber)' : 'var(--green)' }}>{work.unassigned}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Unassigned in queue →</div>
            </button>
          )}
          {isApprover && (
            <button className="card" style={{ padding: '10px 14px', flex: 1, minWidth: 130, textAlign: 'left', cursor: 'pointer' }} onClick={() => onNavigate('approvals')}>
              <div style={{ fontSize: 20, fontWeight: 700, fontFamily: 'var(--font-head)', color: work.approvals > 0 ? 'var(--accent)' : 'var(--green)' }}>{work.approvals}</div>
              <div style={{ fontSize: 10, color: 'var(--muted)' }}>Awaiting approval →</div>
            </button>
          )}
        </div>
      )}

      <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--muted)', letterSpacing: '.6px', marginBottom: 8 }}>
        YOUR REQUESTS SNAPSHOT
      </div>
      <div className="card" style={{ marginBottom: 22 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr 1fr', background: 'var(--ink)' }}>
          {['Department', 'Requests', 'Avg delivery time', 'Delayed / pending'].map((h, i) => (
            <div key={h} style={{ padding: '10px 16px', fontSize: 10, fontWeight: 600, color: i === 0 ? '#fff' : '#8FA0BE', letterSpacing: '.4px', textTransform: 'uppercase' }}>
              {h}
            </div>
          ))}
        </div>
        {(['IT', 'ADMIN', 'PROC'] as DeptCode[]).map((d) => {
          const c = DEPT_COLOR[d]
          const s = deptRow(d)
          return (
            <div
              key={d}
              style={{ display: 'grid', gridTemplateColumns: '200px 1fr 1fr 1fr', borderTop: '1px solid var(--line)', cursor: 'pointer' }}
              onClick={() => onNavigate('requests')}
            >
              <div style={cell}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.rail, flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{c.label}</div>
                  <div style={ms}>{d === 'IT' ? 'Hardware · Access · Software' : d === 'PROC' ? 'Purchasing · Vendors · Orders' : 'Travel · Facilities · Fleet'}</div>
                </div>
              </div>
              <div style={cell}>
                <div>
                  <div style={{ ...mv, color: c.rail }}>{s.mine.length}</div>
                  <div style={ms}>Total requests</div>
                </div>
                {s.closed.length > 0 && (
                  <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>
                    {s.closed.length} closed
                  </span>
                )}
              </div>
              <div style={cell}>
                <div>
                  <div style={{ ...mv, color: 'var(--green)' }}>{s.avg ? `${s.avg} days` : '—'}</div>
                  <div style={ms}>Avg request to close</div>
                </div>
              </div>
              <div style={cell}>
                <div>
                  <div style={{ ...mv, color: s.late.length > 0 ? 'var(--red)' : 'var(--ink)' }}>{s.open.length}</div>
                  <div style={ms}>Open{s.late.length > 0 ? ` · ${s.late.length} past SLA` : ''}</div>
                </div>
                {s.late.length > 0 && (
                  <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>Action needed</span>
                )}
                <span style={{ marginLeft: 'auto', color: 'var(--muted)' }}>→</span>
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 24, marginBottom: 22, alignItems: 'flex-start' }}>
        <div style={{ width: 200, flexShrink: 0, paddingTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Submit a request</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Pick a service to start — track everything under My requests
          </div>
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
          {services.map((sv) => {
            const c = DEPT_COLOR[sv.dept]
            return (
              <button
                key={sv.id} className="card"
                style={{ padding: 14, cursor: 'pointer', textAlign: 'left', position: 'relative', overflow: 'hidden' }}
                onClick={() => onNavigate('portal')}
              >
                <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: c.rail }} />
                <span className="tile-code" style={{ background: c.soft, color: c.rail }}>{sv.code}</span>
                <div className="row-title" style={{ fontSize: 12.5, marginTop: 8 }}>{sv.name}</div>
                <div className="row-desc">{c.label}</div>
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start' }}>
        <div style={{ width: 200, flexShrink: 0, paddingTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>My equipment</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Hardware and software assigned to you by IT
          </div>
        </div>
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <div className="card" style={{ padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 4, background: 'var(--it)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>My hardware</div>
                <div style={ms}>Devices issued to you</div>
              </div>
              <span className="chip" style={{ background: 'var(--it-soft)', color: 'var(--it)' }}>IT</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div style={{ background: 'var(--surface)', borderRadius: 7, padding: '8px 10px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--it)' }}>{assets.length}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Devices</div>
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 7, padding: '8px 10px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--amber)' }}>
                  {assets.filter((a) => a.status === 'repair').length}
                </div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>In repair</div>
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 7, padding: '8px 10px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>
                  {assets.filter((a) => a.status === 'assigned').length}
                </div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>In use</div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              {assets.slice(0, 3).map((a) => (
                <div key={a.tag} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '3px 0', color: 'var(--ink)' }}>
                  <span className="mono" style={{ color: 'var(--muted)', fontSize: 10.5 }}>{a.tag}</span>
                  {a.model ?? a.category}
                </div>
              ))}
              {assets.length === 0 && <div className="row-desc">No devices assigned.</div>}
            </div>
          </div>

          <div className="card" style={{ padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
            <span style={{ position: 'absolute', top: 0, bottom: 0, left: 0, width: 4, background: 'var(--admin)' }} />
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>My software</div>
                <div style={ms}>License seats assigned to you</div>
              </div>
              <span className="chip" style={{ background: 'var(--admin-soft)', color: 'var(--admin)' }}>SW</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              <div style={{ background: 'var(--surface)', borderRadius: 7, padding: '8px 10px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--admin)' }}>{lics.length}</div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Licenses</div>
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 7, padding: '8px 10px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--red)' }}>
                  {lics.filter((l) => l.expires_on && new Date(l.expires_on).getTime() < Date.now() + 90 * 86400000).length}
                </div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Expiring 90d</div>
              </div>
              <div style={{ background: 'var(--surface)', borderRadius: 7, padding: '8px 10px' }}>
                <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)' }}>
                  {lics.filter((l) => !l.expires_on || new Date(l.expires_on).getTime() >= Date.now() + 90 * 86400000).length}
                </div>
                <div style={{ fontSize: 9, color: 'var(--muted)' }}>Healthy</div>
              </div>
            </div>
            <div style={{ marginTop: 10 }}>
              {lics.slice(0, 3).map((l) => (
                <div key={l.name} style={{ display: 'flex', gap: 8, fontSize: 11.5, padding: '3px 0', color: 'var(--ink)' }}>
                  <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--admin)', marginTop: 4 }} />
                  {l.name}
                </div>
              ))}
              {lics.length === 0 && <div className="row-desc">No license seats.</div>}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', marginTop: 22 }}>
        <div style={{ width: 200, flexShrink: 0, paddingTop: 14 }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>Delegate while away</div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
            Hand your duties to a colleague for a date range — takes effect after your
            department head approves. Both of you are notified.
          </div>
        </div>
        <div className="card" style={{ flex: 1, padding: 16 }}>
          {delegations.map((d) => (
            <div key={d.id} style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '4px 0', fontSize: 12.5 }}>
              <span style={{ flex: 1 }}>→ {d.delegate?.display_name ?? '—'}</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{d.starts_on} – {d.ends_on}</span>
              <span className="chip" style={{
                background: d.status === 'approved' ? 'var(--green-soft)' : d.status === 'rejected' ? 'var(--red-soft)' : 'var(--amber-soft)',
                color: d.status === 'approved' ? 'var(--green)' : d.status === 'rejected' ? 'var(--red)' : 'var(--amber)',
              }}>
                {d.status === 'pending' ? 'awaiting dept head' : d.status}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: delegations.length > 0 ? 10 : 0 }}>
            <select className="input" style={{ flex: 1, minWidth: 150 }} value={dform.delegate} onChange={(e) => setDform({ ...dform, delegate: e.target.value })}>
              <option value="">Delegate to…</option>
              {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
            </select>
            <input className="input" type="date" style={{ width: 135 }} value={dform.starts} onChange={(e) => setDform({ ...dform, starts: e.target.value })} />
            <input className="input" type="date" style={{ width: 135 }} value={dform.ends} onChange={(e) => setDform({ ...dform, ends: e.target.value })} />
            <button
              className="btn primary"
              disabled={!dform.delegate || !dform.starts || !dform.ends || dform.ends < dform.starts}
              onClick={requestDelegation}
            >
              Request
            </button>
          </div>
          {dError && <p className="error-note">{dError}</p>}
        </div>
      </div>
    </>
  )
}
