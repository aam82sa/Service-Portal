import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import { PriorityChip, StatusChip } from '../../components/ui'

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
  const [range, setRange] = useState<'30d' | 'month' | 'quarter' | 'all'>('30d')

  const rangeStart = useMemo(() => {
    const now = new Date()
    if (range === '30d') return new Date(now.getTime() - 30 * DAY)
    if (range === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
    if (range === 'quarter') return new Date(now.getTime() - 90 * DAY)
    return null
  }, [range])

  const rangeLabel = range === '30d' ? 'Last 30 days'
    : range === 'month' ? 'This month'
    : range === 'quarter' ? 'Last 90 days' : 'All time'

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
  const unassigned = open.filter((r) => !r.assignee)

  // ---- executive KPI set, scoped to the date range (delta vs the previous
  // equal-length window; hidden for All time) ----
  const inRange = (iso: string, start: Date | null, end?: Date) => {
    const t = new Date(iso).getTime()
    if (start && t < start.getTime()) return false
    if (end && t >= end.getTime()) return false
    return true
  }
  const prevStart = rangeStart
    ? new Date(rangeStart.getTime() - (Date.now() - rangeStart.getTime()))
    : null

  const openedNow = rangeStart ? rows.filter((r) => inRange(r.created_at, rangeStart)) : rows
  const openedPrev = rangeStart ? rows.filter((r) => inRange(r.created_at, prevStart, rangeStart)) : []

  const resolvedIn = (start: Date | null, end?: Date) =>
    rows.filter((r) => DONE.includes(r.status) && r.sla_resolution_due && inRange(r.updated_at, start, end))
  const resNow = resolvedIn(rangeStart)
  const resPrev = rangeStart ? resolvedIn(prevStart, rangeStart) : []
  const pctOf = (list: Row[]) => {
    const met = list.filter((r) => new Date(r.updated_at).getTime() <= new Date(r.sla_resolution_due!).getTime())
    return list.length > 0 ? (met.length / list.length) * 100 : null
  }
  const compNow = pctOf(resNow)
  const compPrev = pctOf(resPrev)

  const hoursOf = (list: Row[]) =>
    list.map((r) => (new Date(r.updated_at).getTime() - new Date(r.created_at).getTime()) / 3600000)
      .filter((h) => h >= 0)
  const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null)
  const median = (xs: number[]) => {
    if (!xs.length) return null
    const s2 = [...xs].sort((a, b) => a - b)
    return s2[Math.floor(s2.length / 2)]
  }
  const avgNow = avg(hoursOf(resNow))
  const avgPrev = avg(hoursOf(resPrev))
  const medNow = median(hoursOf(resNow))

  const breached = open.filter((r) => r.sla_resolution_due && new Date(r.sla_resolution_due).getTime() < Date.now())
  const atRisk = open.filter((r) => {
    if (!r.sla_resolution_due) return false
    const left = new Date(r.sla_resolution_due).getTime() - Date.now()
    return left > 0 && left <= 8 * 3600000
  })
  const attention = [...breached, ...atRisk].sort((a, b) =>
    (a.sla_resolution_due ?? '').localeCompare(b.sla_resolution_due ?? ''))

  // weekly SLA-compliance trend over the last six weeks
  const trend = useMemo(() => {
    const out: { label: string; pct: number | null }[] = []
    for (let w = 5; w >= 0; w--) {
      const end = new Date(Date.now() - w * 7 * DAY)
      const start = new Date(end.getTime() - 7 * DAY)
      const list = rows.filter((r) => DONE.includes(r.status) && r.sla_resolution_due && inRange(r.updated_at, start, end))
      const met = list.filter((r) => new Date(r.updated_at).getTime() <= new Date(r.sla_resolution_due!).getTime())
      out.push({ label: w === 0 ? 'Now' : `W-${w}`, pct: list.length ? (met.length / list.length) * 100 : null })
    }
    return out
  }, [rows])

  const dueText = (r: Row) => {
    const ms = new Date(r.sla_resolution_due!).getTime() - Date.now()
    const h = Math.floor(Math.abs(ms) / 3600000)
    const m = Math.round((Math.abs(ms) % 3600000) / 60000)
    return ms < 0 ? `-${h}h ${m}m` : `${h}h ${m}m`
  }

  const delta = (now: number | null, prev: number | null, unit: string, goodWhenUp: boolean) => {
    if (now == null || prev == null || range === 'all') return null
    const d = now - prev
    if (Math.abs(d) < 0.05) return null
    const up = d > 0
    const good = up === goodWhenUp
    return (
      <span className="chip" style={{ fontSize: 10, background: good ? 'var(--green-soft)' : 'var(--red-soft)', color: good ? 'var(--green)' : 'var(--red)' }}>
        {up ? '\u25b2' : '\u25bc'} {Math.abs(d).toFixed(1)}{unit}
      </span>
    )
  }

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

  const prioCounts = ['P1', 'P2', 'P3', 'P4'].map((p) => [p, open.filter((r) => r.priority === p).length] as const)
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

  const execCard = (
    rail: string, label: string, value: string, deltaChip: React.ReactNode,
    sub: string, barPct: number
  ) => (
    <div className="card" style={{ padding: '16px 18px', position: 'relative', overflow: 'hidden' }}>
      <span style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 4, background: rail }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.4px', paddingTop: 4 }}>{label}</div>
        {deltaChip}
      </div>
      <div style={{ fontSize: 30, fontWeight: 700, color: rail, lineHeight: 1, fontFamily: 'var(--font-head)', marginBottom: 8 }}>{value}</div>
      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{sub}</div>
      <div style={{ height: 4, background: 'var(--surface)', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
        <div style={{ width: `${Math.max(0, Math.min(100, barPct))}%`, height: '100%', background: rail, borderRadius: 2 }} />
      </div>
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
            Insights · Executive dashboard
          </div>
          <h2 className="page-head">Service operations overview</h2>
          <p className="page-sub" style={{ margin: '2px 0 0' }}>
            Service-desk health across IT, Administration and Procurement · {rangeLabel}
          </p>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 5 }}>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn" style={{ padding: '4px 12px', fontSize: 11 }} onClick={() => window.print()}>
              Print / PDF
            </button>
            <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green)', border: '1px solid var(--green)' }}>
              ● Live · {rows.length} records
            </span>
          </div>
          <span style={{ fontSize: 10, color: 'var(--muted)' }}>
            Generated {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
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

      <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--muted)' }}>Date range</span>
          <select className="input" value={range} aria-label="Date range"
            onChange={(e) => setRange(e.target.value as typeof range)}>
            <option value="30d">Last 30 days</option>
            <option value="month">This month</option>
            <option value="quarter">Last 90 days</option>
            <option value="all">All time</option>
          </select>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.4px', color: 'var(--muted)' }}>Department</span>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button style={pill(dept === 'all')} onClick={() => setFilter(() => setDept('all'))}>All</button>
            {(['IT', 'ADMIN', 'PROC'] as DeptCode[]).map((d) => (
              <button key={d} style={pill(dept === d, DEPT_COLOR[d].rail)} onClick={() => setFilter(() => setDept(dept === d ? 'all' : d))}>
                {DEPT_COLOR[d].label}
              </button>
            ))}
          </div>
        </div>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>
          {range === 'all' ? 'No comparison period' : 'Comparing vs. previous period'}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 16 }}>
        {execCard('var(--it)', 'Open requests', String(open.length),
          delta(openedNow.length, openedPrev.length, '', false),
          `${openedNow.length} opened ${range === 'all' ? 'overall' : 'in period'} · ${unassigned.length} unassigned`,
          rows.length > 0 ? Math.round((open.length / rows.length) * 100) : 0)}
        {execCard('var(--green)', 'SLA compliance', compNow != null ? `${compNow.toFixed(1)}%` : '—',
          delta(compNow, compPrev, '%', true),
          `${resNow.length} resolved in period · target 90%`,
          compNow != null ? Math.round(compNow) : 0)}
        {execCard('var(--admin)', 'Avg resolution', avgNow != null ? `${avgNow.toFixed(1)}h` : '—',
          delta(avgNow, avgPrev, 'h', false),
          `median ${medNow != null ? medNow.toFixed(0) : '—'}h · target ≤ 24h`,
          avgNow != null ? Math.min(100, Math.round((avgNow / 24) * 100)) : 0)}
        {execCard('var(--red)', 'SLA breaches', String(breached.length), null,
          `+ ${atRisk.length} at risk within 8h`,
          open.length > 0 ? Math.round((breached.length / open.length) * 100) : 0)}
      </div>

      <div className="card" style={{ padding: '14px 18px', marginBottom: 16 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
          Filter requests
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 18 }}>
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

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 10 }}>
            Requests by department · {rangeLabel}
          </div>
          {(['IT', 'ADMIN', 'PROC'] as DeptCode[]).map((d) => (
            <HBar
              key={d} name={DEPT_COLOR[d].label}
              value={openedNow.filter((r) => r.dept === d).length}
              max={Math.max(1, ...(['IT', 'ADMIN', 'PROC'] as DeptCode[]).map((x) => openedNow.filter((r) => r.dept === x).length))}
              color={DEPT_COLOR[d].rail}
            />
          ))}
          <div style={{ borderTop: '1px solid var(--line)', marginTop: 10, paddingTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
              Open by priority
            </div>
            {prioCounts.map(([p, n]) => (
              <HBar
                key={p} name={PRIO[p].label} value={n} max={maxPrio}
                color={p === 'P1' ? 'var(--red)' : p === 'P2' ? 'var(--amber)' : p === 'P3' ? 'var(--it)' : '#CBD2DE'}
              />
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 4 }}>
            SLA compliance trend — last 6 weeks
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>
            Weekly % of resolutions inside SLA · dashed line = 90% target
          </div>
          <svg viewBox="0 0 560 212" style={{ width: '100%', flex: 1 }} role="img" aria-label="SLA compliance trend, weekly, versus the 90 percent target">
            {[100, 90, 80].map((v) => {
              const y = 20 + ((100 - v) * 160) / 24
              return (
                <g key={v}>
                  <line x1={36} x2={548} y1={y} y2={y}
                    stroke={v === 90 ? 'var(--red)' : 'var(--line)'}
                    strokeDasharray={v === 90 ? '5 4' : undefined} strokeWidth={1} />
                  <text x={30} y={y + 3} textAnchor="end" fontSize={9} fill="var(--muted)">{v}%</text>
                </g>
              )
            })}
            {(() => {
              const pts = trend.map((t, i) => ({
                ...t, x: 60 + i * 96,
                y: t.pct == null ? null : 20 + ((100 - Math.max(76, Math.min(100, t.pct))) * 160) / 24,
              }))
              const line = pts.filter((p) => p.y != null)
              return (
                <>
                  {line.length > 1 && (
                    <polyline
                      points={line.map((p) => `${p.x},${p.y}`).join(' ')}
                      fill="none" stroke="var(--accent)" strokeWidth={2}
                    />
                  )}
                  {pts.map((p) => (
                    <g key={p.label}>
                      {p.y != null ? (
                        <>
                          <circle cx={p.x} cy={p.y} r={3.5} fill="var(--accent)" />
                          <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize={9} fontWeight={600} fill="var(--ink)">
                            {p.pct!.toFixed(0)}%
                          </text>
                        </>
                      ) : (
                        <text x={p.x} y={104} textAnchor="middle" fontSize={9} fill="var(--muted)">—</text>
                      )}
                      <text x={p.x} y={204} textAnchor="middle" fontSize={9} fill="var(--muted)">{p.label}</text>
                    </g>
                  ))}
                </>
              )
            })()}
          </svg>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '11px 16px', borderBottom: '1px solid var(--line)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--red)" strokeWidth="2">
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 700 }}>Breached &amp; at-risk — needs action now</span>
          <span style={{ flex: 1 }} />
          <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>{breached.length} breached</span>
          <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber-ink)' }}>{atRisk.length} at risk</span>
        </div>
        {attention.length === 0 ? (
          <div style={{ padding: '14px 16px', fontSize: 12, color: 'var(--green)' }}>
            No breaches and nothing at risk — every open request is inside its SLA window.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--line)' }}>
                  {['Ref', 'Title', 'Dept', 'Assigned to', 'Priority', 'SLA due', 'Status'].map((h) => (
                    <th key={h} style={{ padding: '8px 12px', fontSize: 10, fontWeight: 600, color: 'var(--muted)', textAlign: 'left', textTransform: 'uppercase', letterSpacing: '.4px', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {attention.slice(0, 8).map((r) => {
                  const isBreach = breached.includes(r)
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid var(--line)', cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
                      <td className="mono" style={{ padding: '8px 12px', fontSize: 11.5, color: 'var(--accent)' }}>{r.ref}</td>
                      <td style={{ padding: '8px 12px', fontSize: 12, fontWeight: 500, maxWidth: 260, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</td>
                      <td style={{ padding: '8px 12px' }}>
                        <span className="chip" style={{ background: DEPT_COLOR[r.dept].soft, color: DEPT_COLOR[r.dept].rail, fontSize: 10 }}>{r.dept}</span>
                      </td>
                      <td style={{ padding: '8px 12px', fontSize: 11.5 }}>
                        {r.assignee?.display_name ?? <span style={{ color: 'var(--amber-ink)', fontWeight: 600 }}>⚠ Unassigned</span>}
                      </td>
                      <td style={{ padding: '8px 12px' }}><PriorityChip priority={r.priority} /></td>
                      <td style={{ padding: '8px 12px', fontSize: 11.5, fontWeight: 600, color: isBreach ? 'var(--red)' : 'var(--amber-ink)', whiteSpace: 'nowrap' }}>
                        {isBreach ? `${dueText(r)} ⚠` : `due in ${dueText(r)}`}
                      </td>
                      <td style={{ padding: '8px 12px' }}><StatusChip status={r.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {attention.length > 8 && (
              <div style={{ padding: '8px 16px', fontSize: 11, color: 'var(--muted)', borderTop: '1px solid var(--line)' }}>
                Showing 8 of {attention.length} — most urgent first.
              </div>
            )}
          </div>
        )}
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
