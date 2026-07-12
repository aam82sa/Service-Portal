import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import { PersonPicker } from '../../components/PersonPicker'

interface QueueRow {
  id: string
  ref: string
  title: string
  dept: DeptCode
  status: string
  priority: string
  created_at: string
  sla_resolution_due: string | null
  sla_paused_at: string | null
  escalated_at: string | null
  assignee_id: string | null
  team_id: string | null
  requester: { display_name: string } | null
  assignee: { display_name: string } | null
}

interface Team {
  id: string
  dept: DeptCode
  name: string
}

interface Membership {
  team_id: string
  profile_id: string
  is_lead: boolean
  profile: { display_name: string } | null
}

interface ViewFilter {
  team?: string                              // team id | 'unrouted'
  status?: string
  priority?: string
  assignee?: 'me' | 'unassigned'
  sla?: 'breached' | 'warning' | 'paused' | 'escalated'
}

interface SavedView {
  id: string
  owner_id: string
  name: string
  scope: 'personal' | 'team'
  team_id: string | null
  filter: ViewFilter
}

const NEXT_ACTIONS: Record<string, { label: string; to: string; primary?: boolean }[]> = {
  new: [{ label: 'Triage', to: 'triaged', primary: true }],
  triaged: [{ label: 'Start', to: 'in_progress', primary: true }],
  in_progress: [
    { label: 'Send for approval', to: 'pending_approval' },
    { label: 'Resolve', to: 'resolved', primary: true },
  ],
  resolved: [{ label: 'Close', to: 'closed', primary: true }],
}

export function SlaRing({ createdAt, due, pausedAt }: {
  createdAt: string
  due: string | null
  pausedAt?: string | null
}) {
  if (!due) return null
  // paused (pending requester): the clock freezes at the pause instant
  const ref = pausedAt ? new Date(pausedAt).getTime() : Date.now()
  const total = new Date(due).getTime() - new Date(createdAt).getTime()
  const left = new Date(due).getTime() - ref
  const frac = Math.max(0, Math.min(1, left / total))
  const color = pausedAt ? 'var(--muted)' : left <= 0 ? 'var(--red)' : frac < 0.2 ? 'var(--amber)' : 'var(--green)'
  const r = 9
  const circ = 2 * Math.PI * r
  const hoursLeft = Math.round(left / 3600000)
  return (
    <span
      title={pausedAt ? 'SLA paused — waiting on the requester' : left <= 0 ? 'SLA breached' : `${hoursLeft}h to SLA target`}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
        <circle cx="12" cy="12" r={r} fill="none" stroke="var(--line)" strokeWidth="3" />
        <circle
          cx="12" cy="12" r={r} fill="none" stroke={color} strokeWidth="3"
          strokeDasharray={pausedAt ? '2 3' : `${circ * frac} ${circ}`}
          strokeLinecap="round" transform="rotate(-90 12 12)"
        />
      </svg>
      <span className="mono" style={{ fontSize: 10.5, color }}>
        {pausedAt ? 'paused' : left <= 0 ? 'breached' : `${hoursLeft}h`}
      </span>
    </span>
  )
}

export function Queue({ onOpen }: { onOpen: (id: string) => void }) {
  const { session, hasRole } = useAuth()
  const [rows, setRows] = useState<QueueRow[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [members, setMembers] = useState<Membership[]>([])
  const [filter, setFilter] = useState<string>('all')     // all | unrouted | <team id>
  const [fStatus, setFStatus] = useState('')
  const [fPriority, setFPriority] = useState('')
  const [fAssignee, setFAssignee] = useState('')
  const [fSla, setFSla] = useState('')
  const [views, setViews] = useState<SavedView[]>([])
  const [activeView, setActiveView] = useState<string | null>(null)
  const [viewName, setViewName] = useState('')
  const [shareTeam, setShareTeam] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const uid = session!.user.id

  const load = useCallback(() => {
    supabase
      .from('requests')
      .select(
        'id, ref, title, dept, status, priority, created_at, sla_resolution_due, sla_paused_at, escalated_at, assignee_id, team_id, requester:profiles!requests_requester_id_fkey(display_name), assignee:profiles!requests_assignee_id_fkey(display_name)'
      )
      .not('status', 'in', '(closed,cancelled)')
      .order('created_at')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows((data as unknown as QueueRow[]) ?? [])
        setLoaded(true)
      })
    supabase.from('teams').select('id, dept, name').order('name')
      .then(({ data }) => setTeams((data as Team[]) ?? []))
    supabase.from('team_members').select('team_id, profile_id, is_lead, profile:profiles(display_name)')
      .then(({ data }) => setMembers((data as unknown as Membership[]) ?? []))
    supabase.from('saved_views').select('*').order('created_at')
      .then(({ data }) => setViews((data as SavedView[]) ?? []))
  }, [])

  useEffect(load, [load])

  const teamName = useMemo(() => new Map(teams.map((t) => [t.id, t.name])), [teams])
  const myTeamIds = useMemo(
    () => new Set(members.filter((m) => m.profile_id === uid).map((m) => m.team_id)),
    [members, uid],
  )
  const myLeadTeamIds = useMemo(
    () => new Set(members.filter((m) => m.profile_id === uid && m.is_lead).map((m) => m.team_id)),
    [members, uid],
  )

  // depts present in my queue; team tabs come from them
  const myDepts = useMemo(() => new Set(rows.map((r) => r.dept)), [rows])
  const tabTeams = teams.filter((t) => myDepts.has(t.dept))
  const isManager = [...myDepts].some((d) => hasRole('dept_head', d) || hasRole('dept_admin', d))
  const unroutedCount = rows.filter((r) => r.team_id === null).length

  const slaState = (r: QueueRow): string | null => {
    if (r.escalated_at) return 'escalated'
    if (r.sla_paused_at) return 'paused'
    if (!r.sla_resolution_due) return null
    const total = new Date(r.sla_resolution_due).getTime() - new Date(r.created_at).getTime()
    const left = new Date(r.sla_resolution_due).getTime() - Date.now()
    if (left <= 0) return 'breached'
    if (total > 0 && left / total < 0.2) return 'warning'
    return null
  }

  const visible = rows.filter((r) => {
    if (filter === 'unrouted' && r.team_id !== null) return false
    if (filter !== 'all' && filter !== 'unrouted' && r.team_id !== filter) return false
    if (fStatus && r.status !== fStatus) return false
    if (fPriority && r.priority !== fPriority) return false
    if (fAssignee === 'me' && r.assignee_id !== uid) return false
    if (fAssignee === 'unassigned' && r.assignee_id !== null) return false
    if (fSla && slaState(r) !== fSla) return false
    return true
  })

  const currentFilter = (): ViewFilter => {
    const f: ViewFilter = {}
    if (filter !== 'all') f.team = filter
    if (fStatus) f.status = fStatus
    if (fPriority) f.priority = fPriority
    if (fAssignee) f.assignee = fAssignee as ViewFilter['assignee']
    if (fSla) f.sla = fSla as ViewFilter['sla']
    return f
  }
  const anyFilter = Object.keys(currentFilter()).length > 0

  const applyView = (v: SavedView) => {
    setActiveView(v.id)
    setFilter(v.filter.team ?? 'all')
    setFStatus(v.filter.status ?? '')
    setFPriority(v.filter.priority ?? '')
    setFAssignee(v.filter.assignee ?? '')
    setFSla(v.filter.sla ?? '')
  }

  const clearFilters = () => {
    setActiveView(null)
    setFilter('all')
    setFStatus('')
    setFPriority('')
    setFAssignee('')
    setFSla('')
  }

  const saveView = async () => {
    if (!viewName.trim()) return
    setError(null)
    const { error: e } = await supabase.from('saved_views').insert({
      owner_id: uid,
      name: viewName.trim(),
      scope: shareTeam ? 'team' : 'personal',
      team_id: shareTeam || null,
      filter: currentFilter(),
    })
    if (e) setError(e.message)
    else setViewName('')
    load()
  }

  const dropView = async (v: SavedView) => {
    setError(null)
    const { error: e } = await supabase.from('saved_views').delete().eq('id', v.id)
    if (e) setError(e.message)
    if (activeView === v.id) clearFilters()
    load()
  }

  /** can this user push (assign to a person) on this row? */
  const pushScope = (r: QueueRow): 'dept' | 'team' | null => {
    if (hasRole('dept_head', r.dept) || hasRole('dept_admin', r.dept) || hasRole('system_admin')) return 'dept'
    if (hasRole('team_lead', r.dept)) return 'team'
    if (r.team_id && myLeadTeamIds.has(r.team_id)) return 'team'
    return null
  }

  const assignOptions = (r: QueueRow, scope: 'dept' | 'team') => {
    const teamIds = scope === 'dept'
      ? new Set(teams.filter((t) => t.dept === r.dept).map((t) => t.id))
      : new Set(r.team_id ? [r.team_id] : [])
    const seen = new Set<string>()
    return members
      .filter((m) => teamIds.has(m.team_id) && m.profile)
      .filter((m) => (seen.has(m.profile_id) ? false : (seen.add(m.profile_id), true)))
      .map((m) => ({ id: m.profile_id, display_name: m.profile!.display_name }))
  }

  const update = async (id: string, patch: Record<string, unknown>) => {
    setError(null)
    const { error: e } = await supabase.from('requests').update(patch).eq('id', id)
    if (e) setError(e.message)
    load()
  }

  return (
    <>
      <h2 className="page-head">Department queue</h2>
      <p className="page-sub">
        Open requests in your department, organized by team. Officers claim from their team
        queue; leads and heads assign. Everything is validated and audit-logged by the database.
      </p>

      <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className={`btn${filter === 'all' ? ' primary' : ''}`} onClick={() => { setFilter('all'); setActiveView(null) }}>
          All
        </button>
        {tabTeams.map((t) => (
          <button key={t.id} className={`btn${filter === t.id ? ' primary' : ''}`} onClick={() => { setFilter(t.id); setActiveView(null) }}>
            {t.name}
            {myTeamIds.has(t.id) && <span style={{ opacity: 0.7 }}> · mine</span>}
          </button>
        ))}
        {isManager && (
          <button
            className={`btn${filter === 'unrouted' ? ' primary' : ''}`}
            style={unroutedCount > 0 ? { color: 'var(--amber)' } : undefined}
            onClick={() => { setFilter('unrouted'); setActiveView(null) }}
          >
            Unrouted{unroutedCount > 0 ? ` (${unroutedCount})` : ''}
          </button>
        )}
        {views.length > 0 && <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--line)' }} />}
        {views.map((v) => (
          <span key={v.id} style={{ display: 'inline-flex' }}>
            <button
              className={`btn${activeView === v.id ? ' primary' : ''}`}
              title={v.scope === 'team' ? `Shared with ${teamName.get(v.team_id ?? '') ?? 'team'}` : 'Personal view'}
              style={{ borderTopRightRadius: 0, borderBottomRightRadius: 0 }}
              onClick={() => applyView(v)}
            >
              {v.scope === 'team' ? '⚑ ' : ''}{v.name}
            </button>
            {(v.owner_id === uid || (v.team_id != null && myLeadTeamIds.has(v.team_id))) && (
              <button className="btn" aria-label={`Delete view ${v.name}`}
                style={{ borderTopLeftRadius: 0, borderBottomLeftRadius: 0, borderLeft: 'none', padding: '2px 7px', color: 'var(--red)' }}
                onClick={() => dropView(v)}>
                ×
              </button>
            )}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" style={{ width: 150, padding: '4px 8px', fontSize: 12 }}
          value={fStatus} onChange={(e) => { setFStatus(e.target.value); setActiveView(null) }}>
          <option value="">any status</option>
          {['new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester', 'resolved'].map((s) => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
        <select className="input" style={{ width: 100, padding: '4px 8px', fontSize: 12 }}
          value={fPriority} onChange={(e) => { setFPriority(e.target.value); setActiveView(null) }}>
          <option value="">any priority</option>
          {['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
        <select className="input" style={{ width: 130, padding: '4px 8px', fontSize: 12 }}
          value={fAssignee} onChange={(e) => { setFAssignee(e.target.value); setActiveView(null) }}>
          <option value="">any assignee</option>
          <option value="me">assigned to me</option>
          <option value="unassigned">unassigned</option>
        </select>
        <select className="input" style={{ width: 130, padding: '4px 8px', fontSize: 12 }}
          value={fSla} onChange={(e) => { setFSla(e.target.value); setActiveView(null) }}>
          <option value="">any SLA state</option>
          <option value="breached">breached</option>
          <option value="warning">at risk</option>
          <option value="paused">paused</option>
          <option value="escalated">escalated</option>
        </select>
        {anyFilter && (
          <>
            <button className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={clearFilters}>
              Clear
            </button>
            <span style={{ flex: 1 }} />
            <input className="input" style={{ width: 160, padding: '4px 8px', fontSize: 12 }}
              placeholder="Save view as…" value={viewName}
              onChange={(e) => setViewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') saveView() }} />
            {myLeadTeamIds.size > 0 && (
              <select className="input" style={{ width: 160, padding: '4px 8px', fontSize: 12 }}
                title="Share with a team you lead"
                value={shareTeam} onChange={(e) => setShareTeam(e.target.value)}>
                <option value="">personal</option>
                {teams.filter((t) => myLeadTeamIds.has(t.id)).map((t) => (
                  <option key={t.id} value={t.id}>share: {t.name}</option>
                ))}
              </select>
            )}
            <button className="btn primary" style={{ padding: '4px 10px', fontSize: 12 }}
              disabled={!viewName.trim()} onClick={saveView}>
              Save view
            </button>
          </>
        )}
      </div>

      <div className="card">
        {visible.map((r) => {
          const c = DEPT_COLOR[r.dept]
          const actions = NEXT_ACTIONS[r.status] ?? []
          const mine = r.assignee_id === uid
          const scope = pushScope(r)
          const isHead = scope === 'dept'
          return (
            <div className="row" key={r.id}>
              <span
                style={{ width: 4, alignSelf: 'stretch', background: c.rail, borderRadius: 2 }}
              />
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink)', width: 84 }}>
                {r.ref}
              </span>
              <div style={{ flex: 1, minWidth: 0, cursor: 'pointer' }} onClick={() => onOpen(r.id)}>
                <div className="row-title">{r.title}</div>
                <div className="row-desc">
                  {r.requester?.display_name ?? 'Unknown'} ·{' '}
                  {r.team_id ? teamName.get(r.team_id) ?? 'team' : 'unrouted'} ·{' '}
                  {r.assignee ? `assigned to ${r.assignee.display_name}` : 'unassigned'}
                </div>
              </div>
              <SlaRing createdAt={r.created_at} due={r.sla_resolution_due} pausedAt={r.sla_paused_at} />
              <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                {r.priority}
              </span>
              <span className="chip" style={{ background: c.soft, color: c.rail }}>
                {r.status.replace('_', ' ')}
              </span>
              {r.escalated_at && (
                <span className="chip" title="SLA breached — escalated per the escalation rules"
                  style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>
                  escalated
                </span>
              )}
              {scope && (
                <PersonPicker
                  small width={150}
                  people={assignOptions(r, scope)}
                  value={r.assignee_id}
                  placeholder="Assign to…"
                  onPick={(p) => update(r.id, { assignee_id: p.id })}
                />
              )}
              {isHead && (
                <select
                  className="input" style={{ width: 120, padding: '4px 8px', fontSize: 12 }}
                  value={r.team_id ?? ''}
                  onChange={(e) => update(r.id, { team_id: e.target.value || null })}
                  title="Move to another team"
                >
                  <option value="">unrouted</option>
                  {teams.filter((t) => t.dept === r.dept).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
              {!scope && !r.assignee_id && (
                <button className="btn" onClick={() => update(r.id, { assignee_id: uid })}>
                  Assign to me
                </button>
              )}
              {!scope && mine && (
                <button className="btn" onClick={() => update(r.id, { assignee_id: null })}>
                  Hand back
                </button>
              )}
              {(mine || !r.assignee_id) &&
                actions.map((a) => (
                  <button
                    key={a.to}
                    className={`btn${a.primary ? ' primary' : ''}`}
                    onClick={() => update(r.id, { status: a.to })}
                  >
                    {a.label}
                  </button>
                ))}
            </div>
          )
        })}
        {loaded && visible.length === 0 && !error && (
          <div className="row row-desc">
            {filter === 'unrouted' ? 'Nothing unrouted — routing rules are covering everything.' : 'The queue is clear.'}
          </div>
        )}
        {!loaded && !error && <div className="row row-desc">Loading queue…</div>}
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
