import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../lib/types'

interface Row {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  priority: string
  created_at: string
  updated_at: string
  sla_resolution_due: string | null
  assignee: { display_name: string } | null
  requester: { display_name: string } | null
}

interface Lic {
  name: string
  vendor: string | null
  expires_on: string
}

interface Alert {
  detail: Record<string, string>
  created_at: string
  actor: { display_name: string } | null
}

const CLOSED = ['closed', 'cancelled']
const DONE = ['resolved', 'closed']
const DAY = 24 * 3600 * 1000
const PAGE_SIZE = 10

const PRIO: Record<string, { label: string; bg: string; fg: string }> = {
  P1: { label: 'P1 Critical', bg: 'var(--ink)', fg: '#FFC9C9' },
  P2: { label: 'P2 High', bg: 'var(--red-soft)', fg: 'var(--red)' },
  P3: { label: 'P3 Normal', bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  P4: { label: 'P4 Low', bg: 'var(--surface)', fg: 'var(--muted)' },
}

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  new: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  triaged: { bg: 'var(--admin-soft)', fg: 'var(--admin)' },
  in_progress: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  pending_approval: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  pending_requester: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  escalated: { bg: 'var(--red-soft)', fg: 'var(--red)' },
  resolved: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  closed: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  cancelled: { bg: 'var(--surface)', fg: 'var(--muted)' },
}

const STATUS_COLOR: Record<string, string> = {
  new: 'var(--it)', triaged: 'var(--admin)', in_progress: '#6E8FE0',
  pending_approval: 'var(--accent)', pending_requester: 'var(--amber)',
  escalated: 'var(--red)', resolved: 'var(--green)', closed: '#1E6B48', cancelled: '#CBD2DE',
}

function Donut({ parts, centerTop, centerSub }: {
  parts: { v: number; c: string }[]; centerTop: string; centerSub: string
}) {
  const total = parts.reduce((s, p) => s + p.v, 0) || 1
  const R = 50
  const C = 2 * Math.PI * R
  let acc = 0
  return (
    <div style={{ position: 'relative', width: 128, height: 128, margin: '0 auto' }}>
      <svg viewBox="0 0 128 128" width="128" height="128">
        <circle cx="64" cy="64" r={R} fill="none" stroke="var(--surface)" strokeWidth="17" />
        {parts.filter((p) => p.v > 0).map((p, i) => {
          const frac = p.v / total
          const el = (
            <circle
              key={i} cx="64" cy="64" r={R} fill="none" stroke={p.c} strokeWidth="17"
              strokeDasharray={`${frac * C} ${C}`} strokeDashoffset={-acc * C}
              transform="rotate(-90 64 64)"
            />
          )
          acc += frac
          return el
        })}
      </svg>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--green)', fontFamily: 'var(--font-head)' }}>{centerTop}</div>
        <div style={{ fontSize: 9, color: 'var(--muted)' }}>{centerSub}</div>
      </div>
    </div>
  )
}

function HBar({ name, value, max, color, nameColor }: {
  name: string; value: number; max: number; color: string; nameColor?: string
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
      <span style={{ fontSize: 11, width: 128, flexShrink: 0, textAlign: 'right', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: nameColor ?? 'var(--ink)' }}>
        {name}
      </span>
      <div style={{ flex: 1, background: 'var(--surface)', borderRadius: 3, height: 15, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(3, (value / Math.max(1, max)) * 100)}%`, height: '100%', borderRadius: 3, background: color }} />
      </div>
      <span className="mono" style={{ fontSize: 10.5, width: 26, textAlign: 'right', color: nameColor ?? 'var(--muted)' }}>{value}</span>
    </div>
  )
}

export function Insights({ onOpen }: { onOpen: (id: string) => void }) {
  const { hasRole } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [expiring, setExpiring] = useState<Lic[]>([])
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [error, setError] = useState<string | null>(null)

  const [kpi, setKpi] = useState<'all' | 'done' | 'open'>('all')
  const [who, setWho] = useState('')
  const [dept, setDept] = useState<'all' | DeptCode>('all')
  const [prio, setPrio] = useState('all')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState<{ col: keyof Row | 'assignee' | 'requester'; dir: 1 | -1 }>({ col: 'created_at', dir: -1 })
  const [page, setPage] = useState(1)
  const [openRow, setOpenRow] = useState<string | null>(null)
  const dept360 = hasRole('team_lead') || hasRole('executive') || hasRole('system_admin')

  useEffect(() => {
    supabase
      .from('requests')
      .select('id, ref, title, dept, status, priority, created_at, updated_at, sla_resolution_due, assignee:profiles!requests_assignee_id_fkey(display_name), requester:profiles!requests_requester_id_fkey(display_name)')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows((data as unknown as Row[]) ?? [])
      })
    supabase
      .from('licenses')
      .select('name, vendor, expires_on')
      .eq('status', 'active')
      .not('expires_on', 'is', null)
      .lte('expires_on', new Date(Date.now() + 90 * DAY).toISOString().slice(0, 10))
      .then(({ data }) => setExpiring((data as Lic[]) ?? []))
    supabase
      .from('admin_events')
      .select('detail, created_at, actor:profiles(display_name)')
      .eq('area', 'governance')
      .eq('action', 'closed_request_changed')
      .order('id', { ascending: false })
      .limit(5)
      .then(({ data }) => setAlerts((data as unknown as Alert[]) ?? []))
  }, [])

  const open = rows.filter((r) => !CLOSED.includes(r.status))
  const done = rows.filter((r) => DONE.includes(r.status))
  const unassigned = open.filter((r) => !r.assignee)
  const doneWithSla = done.filter((r) => r.sla_resolution_due)
  const slaMet = doneWithSla.filter((r) => new Date(r.updated_at).getTime() <= new Date(r.sla_resolution_due!).getTime())
  const slaPct = doneWithSla.length > 0 ? Math.round((slaMet.length / doneWithSla.length) * 100) : null

  const assignees = useMemo(() => {
    const m = new Map<string, number>()
    rows.forEach((r) => {
      if (r.assignee) m.set(r.assignee.display_name, (m.get(r.assignee.display_name) ?? 0) + 1)
    })
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows])

  const filtered = useMemo(() => {
    let out = rows
    if (kpi === 'done') out = out.filter((r) => DONE.includes(r.status))
    if (kpi === 'open') out = out.filter((r) => !CLOSED.includes(r.status))
    if (who === 'unassigned') out = out.filter((r) => !r.assignee)
    else if (who) out = out.filter((r) => r.assignee?.display_name === who)
    if (dept !== 'all') out = out.filter((r) => r.dept === dept)
    if (prio !== 'all') out = out.filter((r) => r.priority === prio)
    if (search.trim()) {
      const q = search.toLowerCase()
      out = out.filter((r) =>
        `${r.ref} ${r.title} ${r.assignee?.display_name ?? ''} ${r.requester?.display_name ?? ''}`.toLowerCase().includes(q)
      )
    }
    const get = (r: Row) =>
      sort.col === 'assignee' ? r.assignee?.display_name ?? ''
      : sort.col === 'requester' ? r.requester?.display_name ?? ''
      : String(r[sort.col] ?? '')
    return [...out].sort((a, b) => get(a).localeCompare(get(b)) * sort.dir)
  }, [rows, kpi, who, dept, prio, search, sort])

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const setFilter = (fn: () => void) => { fn(); setPage(1); setOpenRow(null) }

  const clickSort = (col: typeof sort.col) =>
    setSort((s) => ({ col, dir: s.col === col ? ((s.dir * -1) as 1 | -1) : 1 }))

  const statusCounts = filtered.reduce<Record<string, number>>((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1
    return acc
  }, {})
  const donePct = filtered.length > 0
    ? Math.round((filtered.filter((r) => DONE.includes(r.status)).length / filtered.length) * 100)
    : 0

  const assigneeChart = useMemo(() => {
    const m = new Map<string, number>()
    filtered.forEach((r) => {
      const k = r.assignee?.display_name ?? '__un__'
      m.set(k, (m.get(k) ?? 0) + 1)
    })
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [filtered])
  const maxAssignee = Math.max(1, ...assigneeChart.map(([, n]) => n))

  const prioCounts = ['P1', 'P2', 'P3', 'P4'].map((p) => [p, filtered.filter((r) => r.priority === p).length] as const)
  const maxPrio = Math.max(1, ...prioCounts.map(([, n]) => n))

  const activeTags: { label: string; clear: () => void }[] = []
  if (kpi !== 'all') activeTags.push({ label: kpi === 'done' ? 'Completed only' : 'Open only', clear: () => setKpi('all') })
  if (who) activeTags.push({ label: who === 'unassigned' ? 'Unassigned' : who, clear: () => setWho('') })
  if (dept !== 'all') activeTags.push({ label: DEPT_COLOR[dept].label, clear: () => setDept('all') })
  if (prio !== 'all') activeTags.push({ label: PRIO[prio].label, clear: () => setPrio('all') })

  const pill = (active: boolean, color = 'var(--accent)') => ({
    fontSize: 11, padding: '5px 13px', borderRadius: 20, cursor: 'pointer', fontWeight: 500,
    border: `1.5px solid ${active ? color : 'var(--line)'}`,
    background: active ? color : 'var(--surface)', color: active ? '#fff' : 'var(--muted)',
  } as const)

  const kd = (v: number | string, color: string, lbl: string) => (
    <div style={{ textAlign: 'center', background: 'var(--surface)', borderRadius: 6, padding: '6px 4px' }}>
      <div style={{ fontSize: 14, fontWeight: 700, color }}>{v}</div>
      <div style={{ fontSize: 9, color: 'var(--muted)' }}>{lbl}</div>
    </div>
  )

  const kpiCard = (
    id: 'all' | 'done' | 'open', rail: string, label: string, value: number,
    tag: { text: string; bg: string; fg: string }, details: React.ReactNode, barPct?: number
  ) => (
    <div
      className="card"
      style={{
        padding: '16px 18px', cursor: 'pointer', position: 'relative', overflow: 'hidden',
        outline: kpi === id ? `2px solid ${rail}` : 'none',
      }}
      onClick={() => setFilter(() => setKpi(kpi === id ? 'all' : id))}
    >
      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: rail }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', paddingTop: 4 }}>{label}</div>
        <span className="chip" style={{ background: tag.bg, color: tag.fg, fontSize: 10 }}>{tag.text}</span>
      </div>
      <div style={{ fontSize: 32, fontWeight: 700, color: rail, lineHeight: 1, fontFamily: 'var(--font-head)', marginBottom: 10 }}>{value}</div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6, paddingTop: 8, borderTop: '1px solid var(--line)' }}>
        {details}
      </div>
      {barPct !== undefined && (
        <div style={{ height: 4, background: 'var(--surface)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
          <div style={{ width: `${barPct}%`, height: '100%', background: rail, borderRadius: 2 }} />
        </div>
      )}
    </div>
  )

  const th = (label: string, col: typeof sort.col) => (
    <th
      style={{ padding: '9px 12px', fontSize: 10, fontWeight: 600, color: '#fff', textAlign: 'left', whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}
      onClick={() => clickSort(col)}
    >
      {label} <span style={{ opacity: 0.4, fontSize: 9 }}>{sort.col === col ? (sort.dir === 1 ? '▲' : '▼') : '⇅'}</span>
    </th>
  )

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', paddingBottom: 14, borderBottom: '1px solid var(--line)', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--admin)', textTransform: 'uppercase', letterSpacing: '.7px', marginBottom: 4 }}>
            Insights · Operations tracker
          </div>
          <h2 className="page-head">Request operations</h2>
          <p className="page-sub" style={{ margin: '2px 0 0' }}>
            {rows.length} requests in your scope · click any row to expand full details
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => window.print()}>
              Print / PDF
            </button>
            <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green)', border: '1px solid var(--green)' }}>
              ✓ live from database · {rows.length} records
            </span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </span>
        </div>
      </div>

      {unassigned.length > 0 && dept360 && (
        <div style={{ background: 'var(--red-soft)', border: '1px solid var(--red)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: 'var(--red)', flex: 1 }}>
            <b>{unassigned.length} open request{unassigned.length > 1 ? 's have' : ' has'} no assignee.</b>{' '}
            Filter below to isolate and action them.
          </span>
          <button className="btn" style={{ color: 'var(--red)', borderColor: 'var(--red)', padding: '4px 12px', fontSize: 11 }}
            onClick={() => setFilter(() => { setWho('unassigned'); setKpi('open') })}>
            Show unassigned →
          </button>
        </div>
      )}
      {expiring.length > 0 && (
        <div style={{ background: 'var(--amber-soft)', border: '1px solid var(--amber)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12.5, color: 'var(--amber)' }}>
          <b>{expiring.length} license{expiring.length > 1 ? 's' : ''} expiring within 90 days:</b>{' '}
          {expiring.map((l) => `${l.name} (${l.expires_on})`).join(' · ')}
        </div>
      )}
      {dept360 && open.filter((r) => !r.sla_resolution_due).length > 0 && (
        <div style={{ background: 'var(--amber-soft)', border: '1px solid var(--amber)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12.5, color: 'var(--amber)' }}>
          <b>Data quality note:</b> {open.filter((r) => !r.sla_resolution_due).length} open request
          {open.filter((r) => !r.sla_resolution_due).length > 1 ? 's have' : ' has'} no SLA due date —
          set SLA targets on their services to improve tracking.
        </div>
      )}
      {alerts.length > 0 && dept360 && (
        <div style={{ background: 'var(--red-soft)', border: '1px solid var(--red)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12.5, color: 'var(--red)' }}>
          <b>Governance:</b>{' '}
          {alerts.slice(0, 3).map((a) => `${a.detail.ref} reopened by ${a.actor?.display_name ?? 'staff'} (${new Date(a.created_at).toLocaleDateString()})`).join(' · ')}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14, marginBottom: 16 }}>
        {kpiCard('all', 'var(--it)', 'Total requests', rows.length,
          { text: 'All records', bg: 'var(--green-soft)', fg: 'var(--green)' },
          <>
            {kd(rows.filter((r) => r.priority === 'P1').length, 'var(--red)', 'P1 Critical')}
            {kd(rows.filter((r) => r.priority === 'P2').length, 'var(--amber)', 'P2 High')}
            {kd(rows.filter((r) => ['P3', 'P4'].includes(r.priority)).length, 'var(--muted)', 'P3 / P4')}
          </>
        )}
        {kpiCard('done', 'var(--green)', 'Completed / closed', done.length,
          { text: `${rows.length > 0 ? Math.round((done.length / rows.length) * 100) : 0}% rate`, bg: 'var(--green-soft)', fg: 'var(--green)' },
          <>
            {kd(rows.filter((r) => r.status === 'resolved').length, 'var(--green)', 'Resolved')}
            {kd(rows.filter((r) => r.status === 'closed').length, 'var(--green)', 'Closed')}
            {kd(slaPct !== null ? `${slaPct}%` : '—', slaPct !== null && slaPct < 70 ? 'var(--red)' : 'var(--green)', 'SLA met')}
          </>,
          rows.length > 0 ? Math.round((done.length / rows.length) * 100) : 0
        )}
        {kpiCard('open', 'var(--amber)', 'Open requests', open.length,
          { text: open.length > 0 ? 'Needs attention' : 'All clear', bg: open.length > 0 ? 'var(--red-soft)' : 'var(--green-soft)', fg: open.length > 0 ? 'var(--red)' : 'var(--green)' },
          <>
            {kd(open.filter((r) => r.status === 'new').length, 'var(--muted)', 'New')}
            {kd(open.filter((r) => ['triaged', 'in_progress'].includes(r.status)).length, 'var(--it)', 'In progress')}
            {kd(open.filter((r) => ['pending_approval', 'pending_requester', 'escalated'].includes(r.status)).length, 'var(--red)', 'Waiting')}
          </>,
          rows.length > 0 ? Math.round((open.length / rows.length) * 100) : 0
        )}
      </div>

      <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
          Filter requests
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 18 }}>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Assigned to</div>
            <select className="input" value={who} onChange={(e) => setFilter(() => setWho(e.target.value))}>
              <option value="">All team members</option>
              {assignees.map(([name, n]) => (
                <option key={name} value={name}>{name} ({n})</option>
              ))}
              {unassigned.length > 0 && <option value="unassigned">⚠ Unassigned ({unassigned.length})</option>}
            </select>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Department</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={pill(dept === 'all')} onClick={() => setFilter(() => setDept('all'))}>All</button>
              {(['IT', 'ADMIN'] as DeptCode[]).map((d) => (
                <button key={d} style={pill(dept === d, DEPT_COLOR[d].rail)} onClick={() => setFilter(() => setDept(dept === d ? 'all' : d))}>
                  {DEPT_COLOR[d].label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, marginBottom: 7 }}>Priority</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button style={pill(prio === 'all')} onClick={() => setFilter(() => setPrio('all'))}>All</button>
              {(['P1', 'P2', 'P3', 'P4'] as const).map((p) => (
                <button
                  key={p}
                  style={pill(prio === p, p === 'P1' ? 'var(--red)' : p === 'P2' ? 'var(--amber)' : 'var(--accent)')}
                  onClick={() => setFilter(() => setPrio(prio === p ? 'all' : p))}
                >
                  {p} ({rows.filter((r) => r.priority === p).length})
                </button>
              ))}
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTop: '1px solid var(--line)', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            Showing <b style={{ color: 'var(--ink)' }}>{filtered.length}</b> requests
            {activeTags.map((t) => (
              <span key={t.label} className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)', cursor: 'pointer' }} onClick={t.clear}>
                {t.label} ✕
              </span>
            ))}
            {activeTags.length > 0 && (
              <span style={{ color: 'var(--red)', fontWeight: 600, cursor: 'pointer' }}
                onClick={() => setFilter(() => { setKpi('all'); setWho(''); setDept('all'); setPrio('all'); setSearch('') })}>
                Clear all
              </span>
            )}
          </div>
          <input
            className="input" style={{ width: 220, padding: '7px 12px', fontSize: 11.5 }}
            placeholder="Search ref, title, people…"
            value={search} onChange={(e) => setFilter(() => setSearch(e.target.value))}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>
            Requests by assignee
          </div>
          {assigneeChart.map(([name, n]) => (
            <HBar
              key={name}
              name={name === '__un__' ? '⚠ Unassigned' : name}
              value={n} max={maxAssignee}
              color={name === '__un__' ? 'var(--red)' : 'var(--admin)'}
              nameColor={name === '__un__' ? 'var(--red)' : undefined}
            />
          ))}
          {assigneeChart.length === 0 && <div className="row-desc">Nothing matches the filters.</div>}
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>
            Status breakdown
          </div>
          <Donut
            parts={Object.entries(statusCounts).map(([s, v]) => ({ v, c: STATUS_COLOR[s] ?? 'var(--muted)' }))}
            centerTop={`${donePct}%`} centerSub="complete"
          />
          <div style={{ marginTop: 8 }}>
            {Object.entries(statusCounts).map(([s, n]) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, padding: '2px 0' }}>
                <span style={{ width: 9, height: 9, borderRadius: 2, background: STATUS_COLOR[s] ?? 'var(--muted)' }} />
                {s.replace('_', ' ')}
                <span style={{ marginLeft: 'auto', fontWeight: 600 }}>{n}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>
            Priority distribution
          </div>
          {prioCounts.map(([p, n]) => (
            <HBar
              key={p} name={PRIO[p].label} value={n} max={maxPrio}
              color={p === 'P1' ? 'var(--red)' : p === 'P2' ? 'var(--amber)' : p === 'P3' ? 'var(--it)' : '#CBD2DE'}
            />
          ))}
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
              By department
            </div>
            {(['IT', 'ADMIN'] as DeptCode[]).map((d) => (
              <HBar
                key={d} name={DEPT_COLOR[d].label}
                value={filtered.filter((r) => r.dept === d).length}
                max={Math.max(1, ...(['IT', 'ADMIN'] as DeptCode[]).map((x) => filtered.filter((r) => r.dept === x).length))}
                color={DEPT_COLOR[d].rail}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '11px 16px', borderBottom: '1px solid var(--line)' }}>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Request register — click any row to expand</span>
          <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
            Showing {pageRows.length} of {filtered.length}
          </span>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: 'var(--ink)' }}>
                {th('Ref', 'ref')}
                {th('Title', 'title')}
                {th('Dept', 'dept')}
                {th('Assigned to', 'assignee')}
                {th('Requester', 'requester')}
                {th('Priority', 'priority')}
                {th('Created', 'created_at')}
                {th('SLA due', 'sla_resolution_due')}
                {th('Status', 'status')}
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r, i) => {
                const st = STATUS_STYLE[r.status] ?? STATUS_STYLE.closed
                const overdue = r.sla_resolution_due && !DONE.includes(r.status) && !CLOSED.includes(r.status)
                  && new Date(r.sla_resolution_due).getTime() < Date.now()
                const isOpen = openRow === r.id
                return (
                  <>
                    <tr
                      key={r.id}
                      style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer', background: isOpen ? 'var(--it-soft)' : i % 2 === 1 ? 'var(--surface)' : 'var(--card)' }}
                      onClick={() => setOpenRow(isOpen ? null : r.id)}
                    >
                      <td className="mono" style={{ padding: '9px 12px', fontSize: 11.5, color: 'var(--accent)' }}>{r.ref}</td>
                      <td style={{ padding: '9px 12px', fontSize: 12, fontWeight: 500, maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</td>
                      <td style={{ padding: '9px 12px' }}>
                        <span className="chip" style={{ background: DEPT_COLOR[r.dept].soft, color: DEPT_COLOR[r.dept].rail, fontSize: 10 }}>{r.dept}</span>
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11.5 }}>
                        {r.assignee?.display_name ?? (
                          <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)', fontSize: 10 }}>⚠ Unassigned</span>
                        )}
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11.5, color: 'var(--muted)' }}>{r.requester?.display_name ?? '—'}</td>
                      <td style={{ padding: '9px 12px' }}>
                        <span className="chip" style={{ background: PRIO[r.priority].bg, color: PRIO[r.priority].fg, fontSize: 10 }}>{r.priority}</span>
                      </td>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: 'var(--muted)' }}>{new Date(r.created_at).toLocaleDateString()}</td>
                      <td style={{ padding: '9px 12px', fontSize: 11, color: overdue ? 'var(--red)' : 'var(--muted)', fontWeight: overdue ? 600 : 400 }}>
                        {r.sla_resolution_due ? `${new Date(r.sla_resolution_due).toLocaleDateString()}${overdue ? ' ⚠' : ''}` : '—'}
                      </td>
                      <td style={{ padding: '9px 12px' }}>
                        <span className="chip" style={{ background: st.bg, color: st.fg, fontSize: 10 }}>{r.status.replace('_', ' ')}</span>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-d`} style={{ background: 'var(--it-soft)', borderTop: '2px solid var(--it)' }}>
                        <td colSpan={9} style={{ padding: '14px 18px' }}>
                          <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', marginBottom: 10 }}>
                            {r.ref} — {r.title}
                          </div>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
                            {[
                              ['Department', DEPT_COLOR[r.dept].label],
                              ['Assigned to', r.assignee?.display_name ?? 'Unassigned'],
                              ['Requester', r.requester?.display_name ?? '—'],
                              ['Priority', PRIO[r.priority].label],
                              ['Status', r.status.replace('_', ' ')],
                              ['Created', new Date(r.created_at).toLocaleString()],
                              ['Last update', new Date(r.updated_at).toLocaleString()],
                              ['SLA due', r.sla_resolution_due ? new Date(r.sla_resolution_due).toLocaleString() : 'Not set'],
                            ].map(([l, v]) => (
                              <div key={l}>
                                <div style={{ fontSize: 9, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.3px', marginBottom: 3 }}>{l}</div>
                                <div style={{ fontSize: 12, fontWeight: 600 }}>{v}</div>
                              </div>
                            ))}
                            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
                              <button className="btn primary" style={{ padding: '6px 14px', fontSize: 12 }} onClick={(e) => { e.stopPropagation(); onOpen(r.id) }}>
                                Open full record →
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
              {pageRows.length === 0 && (
                <tr><td colSpan={9} style={{ textAlign: 'center', padding: 16, color: 'var(--muted)', fontSize: 12, fontStyle: 'italic' }}>
                  Nothing matches the current filters.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 16px', borderTop: '1px solid var(--line)', fontSize: 11, color: 'var(--muted)' }}>
          <span>
            Showing {filtered.length === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filtered.length)} of {filtered.length}
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {Array.from({ length: pages }, (_, i) => i + 1).slice(0, 8).map((p) => (
              <button
                key={p} className="btn"
                style={{ padding: '3px 10px', fontSize: 11, background: page === p ? 'var(--accent)' : undefined, color: page === p ? '#fff' : undefined, borderColor: page === p ? 'var(--accent)' : undefined }}
                onClick={() => { setPage(p); setOpenRow(null) }}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
