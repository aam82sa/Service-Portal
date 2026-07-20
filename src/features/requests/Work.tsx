import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import type { DeptCode } from '../../lib/types'
import { PersonPicker } from '../../components/PersonPicker'
import { RequestRow } from '../../components/RequestRow'
import { SkeletonRows } from '../../components/SkeletonRows'
import { Approvals } from './Approvals'

/**
 * The unified Work screen: My work · Team queue · Unrouted · Approvals as
 * segments over ONE list, quick-filter rail, toolbar (search / sort /
 * density / save view), and a bulk-action bar. Layout matches
 * prototype/queue-redesign-reference.html.
 */

export type WorkView = 'mine' | 'queue' | 'unrouted' | 'approvals'

interface WorkRow {
  id: string
  ref: string
  title: string
  /** resolved department code (from dept_id for dynamic streams) */
  dept: DeptCode
  dept_code: string
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

interface Team { id: string; dept: DeptCode; name: string }

interface Membership {
  team_id: string
  profile_id: string
  is_lead: boolean
  profile: { display_name: string } | null
}

interface ViewFilter {
  team?: string
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

const NEXT_ACTIONS: Record<string, { label: string; to: string }[]> = {
  new: [{ label: 'Triage', to: 'triaged' }],
  triaged: [{ label: 'Start', to: 'in_progress' }],
  in_progress: [
    { label: 'Send for approval', to: 'pending_approval' },
    { label: 'Resolve', to: 'resolved' },
  ],
  resolved: [{ label: 'Close', to: 'closed' }],
}

const SLA_FACETS = [
  { key: 'breached', label: 'Breached', dot: 'var(--red)' },
  { key: 'warning', label: 'At risk', dot: 'var(--amber)' },
  { key: 'paused', label: 'Paused', dot: 'var(--muted)' },
  { key: 'escalated', label: 'Escalated', dot: 'var(--red)' },
] as const

const PRIO_FACETS = [
  { key: 'P1', label: 'P1 Critical', dot: 'var(--red)' },
  { key: 'P2', label: 'P2 High', dot: 'var(--amber)' },
  { key: 'P3', label: 'P3 Normal', dot: 'var(--line)' },
  { key: 'P4', label: 'P4 Low', dot: 'var(--line)' },
] as const

export function Work({ onOpen, initialView, onViewChange }: {
  onOpen: (id: string) => void
  initialView?: WorkView
  onViewChange?: (v: WorkView) => void
}) {
  const { session, hasRole } = useAuth()
  const { t } = useTranslation()
  const uid = session!.user.id
  const [rows, setRows] = useState<WorkRow[]>([])
  const [teams, setTeams] = useState<Team[]>([])
  const [members, setMembers] = useState<Membership[]>([])
  const [views, setViews] = useState<SavedView[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [view, setViewState] = useState<WorkView>(initialView ?? 'mine')
  const setView = (v: WorkView) => {
    setViewState(v)
    onViewChange?.(v)
  }
  const [fTeam, setFTeam] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fPriority, setFPriority] = useState('')
  const [fAssignee, setFAssignee] = useState('')
  const [fSla, setFSla] = useState('')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<'sla' | 'newest' | 'priority'>('sla')
  const [compact, setCompact] = useState(false)
  const [activeView, setActiveView] = useState<string | null>(null)
  const [viewName, setViewName] = useState('')
  const [shareTeam, setShareTeam] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const [bulkPrio, setBulkPrio] = useState('')
  const [bulkTeam, setBulkTeam] = useState('')
  const [bulkStatus, setBulkStatus] = useState('')

  const load = useCallback(() => {
    supabase
      .from('requests')
      .select(
        'id, ref, title, dept, status, priority, created_at, sla_resolution_due, sla_paused_at, escalated_at, assignee_id, team_id, requester:profiles!requests_requester_id_fkey(display_name), assignee:profiles!requests_assignee_id_fkey(display_name), dept_ref:departments!requests_dept_id_fk(code)'
      )
      .not('status', 'in', '(closed,cancelled)')
      .order('created_at')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows(((data ?? []) as unknown as (WorkRow & { dept_ref: { code: string } | null })[])
          .map((r) => {
            const code = r.dept_ref?.code ?? r.dept ?? ''
            return { ...r, dept: code, dept_code: code }
          }))
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
  const myDepts = useMemo(() => new Set(rows.map((r) => r.dept)), [rows])
  const isManager = [...myDepts].some((d) => hasRole('dept_head', d) || hasRole('dept_admin', d)) || hasRole('system_admin')
  const isApprover = hasRole('approver')

  const slaState = (r: WorkRow): string | null => {
    if (r.escalated_at) return 'escalated'
    if (r.sla_paused_at) return 'paused'
    if (!r.sla_resolution_due) return null
    const total = new Date(r.sla_resolution_due).getTime() - new Date(r.created_at).getTime()
    const left = new Date(r.sla_resolution_due).getTime() - Date.now()
    if (left <= 0) return 'breached'
    if (total > 0 && left / total < 0.2) return 'warning'
    return null
  }

  // segment scoping first, facets on top
  const scoped = rows.filter((r) => {
    if (view === 'mine') return r.assignee_id === uid
    if (view === 'unrouted') return r.team_id === null
    return true
  })

  const visible = scoped
    .filter((r) => {
      if (fTeam && r.team_id !== fTeam) return false
      if (fStatus && r.status !== fStatus) return false
      if (fPriority && r.priority !== fPriority) return false
      if (fAssignee === 'me' && r.assignee_id !== uid) return false
      if (fAssignee === 'unassigned' && r.assignee_id !== null) return false
      if (fSla && slaState(r) !== fSla) return false
      if (q.trim()) {
        const needle = q.trim().toLowerCase()
        const hay = `${r.ref} ${r.title} ${r.requester?.display_name ?? ''}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      return true
    })
    .sort((a, b) => {
      if (sort === 'newest') return b.created_at.localeCompare(a.created_at)
      if (sort === 'priority') return a.priority.localeCompare(b.priority)
      const ad = a.sla_resolution_due ?? '9999'
      const bd = b.sla_resolution_due ?? '9999'
      return ad.localeCompare(bd)
    })

  const facetCount = (pred: (r: WorkRow) => boolean) => scoped.filter(pred).length

  const currentFilter = (): ViewFilter => {
    const f: ViewFilter = {}
    if (fTeam) f.team = fTeam
    if (fStatus) f.status = fStatus
    if (fPriority) f.priority = fPriority
    if (fAssignee) f.assignee = fAssignee as ViewFilter['assignee']
    if (fSla) f.sla = fSla as ViewFilter['sla']
    return f
  }
  const anyFilter = Object.keys(currentFilter()).length > 0

  const applyView = (v: SavedView) => {
    setActiveView(v.id)
    setView('queue')
    setFTeam(v.filter.team && v.filter.team !== 'unrouted' ? v.filter.team : '')
    setFStatus(v.filter.status ?? '')
    setFPriority(v.filter.priority ?? '')
    setFAssignee(v.filter.assignee ?? '')
    setFSla(v.filter.sla ?? '')
  }

  const facet = (isOn: boolean, set: () => void, clear: () => void) => () => {
    setActiveView(null)
    if (isOn) clear()
    else set()
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
    if (activeView === v.id) setActiveView(null)
    load()
  }

  const update = async (id: string, patch: Record<string, unknown>) => {
    setError(null)
    const { error: e } = await supabase.from('requests').update(patch).eq('id', id)
    if (e) setError(e.message)
    load()
  }

  const bulk = async (patch: Record<string, unknown>) => {
    if (selected.size === 0) return
    setError(null)
    const { error: e } = await supabase.from('requests').update(patch).in('id', [...selected])
    if (e) setError(e.message)
    else setSelected(new Set())
    setBulkPrio(''); setBulkTeam(''); setBulkStatus('')
    load()
  }

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const allSelected = visible.length > 0 && visible.every((r) => selected.has(r.id))

  const pushScope = (r: WorkRow): 'dept' | 'team' | null => {
    if (hasRole('dept_head', r.dept) || hasRole('dept_admin', r.dept) || hasRole('system_admin')) return 'dept'
    if (hasRole('team_lead', r.dept)) return 'team'
    if (r.team_id && myLeadTeamIds.has(r.team_id)) return 'team'
    return null
  }

  const assignOptions = (deptSet: Set<DeptCode>, teamIds?: Set<string>) => {
    const tids = teamIds ?? new Set(teams.filter((t) => deptSet.has(t.dept)).map((t) => t.id))
    const seen = new Set<string>()
    return members
      .filter((m) => tids.has(m.team_id) && m.profile)
      .filter((m) => (seen.has(m.profile_id) ? false : (seen.add(m.profile_id), true)))
      .map((m) => ({ id: m.profile_id, display_name: m.profile!.display_name }))
  }

  const selDepts = new Set(rows.filter((r) => selected.has(r.id)).map((r) => r.dept))
  const canBulkPush = [...selDepts].every((d) => hasRole('dept_head', d) || hasRole('dept_admin', d) || hasRole('team_lead', d)) || hasRole('system_admin')

  // keyboard-only triage: j/k (or arrows) rove across rows, Enter opens the
  // focused row (native button), X selects, A claims, / jumps to search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      const mains = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.qrow .r-main') ?? [])]
      if (mains.length === 0) return
      const idx = mains.findIndex((m) => m === document.activeElement)
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault()
        mains[Math.min(idx + 1, mains.length - 1)]?.focus()
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault()
        mains[Math.max(idx - 1, 0)]?.focus()
      } else if ((e.key === 'x' || e.key === 'X') && idx >= 0) {
        e.preventDefault()
        toggle(visible[idx].id)
      } else if ((e.key === 'a' || e.key === 'A') && idx >= 0) {
        e.preventDefault()
        const r = visible[idx]
        if (!r.assignee_id) update(r.id, { assignee_id: uid })
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const counts = {
    mine: rows.filter((r) => r.assignee_id === uid).length,
    queue: rows.length,
    unrouted: rows.filter((r) => r.team_id === null).length,
    approvals: rows.filter((r) => r.status === 'pending_approval').length,
  }

  const tabTeams = teams.filter((t) => myDepts.has(t.dept))

  return (
    <>
      <h2 className="page-head">{t('work.title')}</h2>
      <p className="page-sub">{t('work.subtitle')}</p>

      <div className="seg" role="tablist" aria-label="Work views">
        <button className={view === 'mine' ? 'active' : ''} role="tab" aria-selected={view === 'mine'}
          onClick={() => setView('mine')}>
          <span>{t('work.myWork')}</span><span className="cnt">{counts.mine}</span>
        </button>
        <button className={view === 'queue' ? 'active' : ''} role="tab" aria-selected={view === 'queue'}
          onClick={() => setView('queue')}>
          <span>{t('work.teamQueue')}</span><span className="cnt">{counts.queue}</span>
        </button>
        {isManager && (
          <button className={view === 'unrouted' ? 'active' : ''} role="tab" aria-selected={view === 'unrouted'}
            onClick={() => setView('unrouted')}>
            <span>{t('work.unrouted')}</span><span className="cnt">{counts.unrouted}</span>
          </button>
        )}
        {isApprover && (
          <button className={view === 'approvals' ? 'active' : ''} role="tab" aria-selected={view === 'approvals'}
            onClick={() => setView('approvals')}>
            <span>{t('work.approvals')}</span><span className="cnt">{counts.approvals}</span>
          </button>
        )}
      </div>

      {view === 'approvals' ? (
        <Approvals />
      ) : (
      <div className="work">
        <aside className="rail">
          {views.length > 0 && <div className="rail-lbl">{t('work.savedViews')}</div>}
          {views.map((v) => (
            <div className="view-row" key={v.id}>
              <button className={`facet${activeView === v.id ? ' on' : ''}`} onClick={() => applyView(v)}
                title={v.scope === 'team' ? `Shared with ${teamName.get(v.team_id ?? '') ?? 'team'}` : 'Personal view'}>
                {v.scope === 'team' && <span className="view-flag">⚑</span>}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.name}</span>
              </button>
              {(v.owner_id === uid || (v.team_id != null && myLeadTeamIds.has(v.team_id))) && (
                <button className="overflow" aria-label={`Delete view ${v.name}`} onClick={() => dropView(v)}>×</button>
              )}
            </div>
          ))}

          {view === 'queue' && tabTeams.length > 0 && (
            <>
              <div className="rail-lbl">{t('work.team')}</div>
              {tabTeams.map((t) => (
                <button key={t.id} className={`facet${fTeam === t.id ? ' on' : ''}`}
                  onClick={facet(fTeam === t.id, () => setFTeam(t.id), () => setFTeam(''))}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {t.name}{myTeamIds.has(t.id) ? ' · mine' : ''}
                  </span>
                  <span className="fc">{facetCount((r) => r.team_id === t.id)}</span>
                </button>
              ))}
            </>
          )}

          <div className="rail-lbl">{t('work.slaState')}</div>
          {SLA_FACETS.map((f) => (
            <button key={f.key} className={`facet${fSla === f.key ? ' on' : ''}`}
              onClick={facet(fSla === f.key, () => setFSla(f.key), () => setFSla(''))}>
              <span className="dot" style={{ background: f.dot }} />{f.label}
              <span className="fc">{facetCount((r) => slaState(r) === f.key)}</span>
            </button>
          ))}

          {view !== 'mine' && (
            <>
              <div className="rail-lbl">{t('work.assignee')}</div>
              <button className={`facet${fAssignee === 'me' ? ' on' : ''}`}
                onClick={facet(fAssignee === 'me', () => setFAssignee('me'), () => setFAssignee(''))}>
                {t('work.assignedToMe')}<span className="fc">{facetCount((r) => r.assignee_id === uid)}</span>
              </button>
              <button className={`facet${fAssignee === 'unassigned' ? ' on' : ''}`}
                onClick={facet(fAssignee === 'unassigned', () => setFAssignee('unassigned'), () => setFAssignee(''))}>
                {t('work.unassigned')}<span className="fc">{facetCount((r) => r.assignee_id === null)}</span>
              </button>
            </>
          )}

          <div className="rail-lbl">{t('work.priority')}</div>
          {PRIO_FACETS.map((f) => (
            <button key={f.key} className={`facet${fPriority === f.key ? ' on' : ''}`}
              onClick={facet(fPriority === f.key, () => setFPriority(f.key), () => setFPriority(''))}>
              <span className="dot" style={{ background: f.dot }} />{f.label}
              <span className="fc">{facetCount((r) => r.priority === f.key)}</span>
            </button>
          ))}
        </aside>

        <section className={`panel${compact ? ' compact' : ''}`} ref={listRef}>
          <div className="toolbar">
            <div className="search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input ref={searchRef} placeholder={t('work.search')} value={q} onChange={(e) => setQ(e.target.value)}
                aria-label="Search requests" />
            </div>
            <span role="status" aria-live="polite" style={{ fontSize: 11, color: 'var(--muted)' }}>
              {t('work.shown', { count: visible.length })}
            </span>
            <div className="tool-spacer" />
            <select className="input" style={{ width: 130, padding: '5px 8px', fontSize: 12 }}
              value={sort} onChange={(e) => setSort(e.target.value as typeof sort)} aria-label="Sort">
              <option value="sla">{t('work.sortSla')}</option>
              <option value="newest">{t('work.sortNewest')}</option>
              <option value="priority">{t('work.sortPriority')}</option>
            </select>
            <div className="density">
              <button className={compact ? '' : 'on'} onClick={() => setCompact(false)}>{t('work.comfortable')}</button>
              <button className={compact ? 'on' : ''} onClick={() => setCompact(true)}>{t('work.compact')}</button>
            </div>
            {anyFilter && (
              <>
                <input className="input" style={{ width: 140, padding: '5px 8px', fontSize: 12 }}
                  placeholder={t('work.saveViewAs')} value={viewName}
                  onChange={(e) => setViewName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') saveView() }} />
                {myLeadTeamIds.size > 0 && (
                  <select className="input" style={{ width: 140, padding: '5px 8px', fontSize: 12 }}
                    value={shareTeam} onChange={(e) => setShareTeam(e.target.value)} aria-label="Share view with a team">
                    <option value="">{t('work.personal')}</option>
                    {teams.filter((t) => myLeadTeamIds.has(t.id)).map((t) => (
                      <option key={t.id} value={t.id}>share: {t.name}</option>
                    ))}
                  </select>
                )}
                <button className="btn" disabled={!viewName.trim()} onClick={saveView}>{t('work.saveView')}</button>
              </>
            )}
          </div>

          {selected.size > 0 && (
            <div className="bulkbar">
              <span className="n">{t('work.selected', { count: selected.size })}</span>
              {canBulkPush && (
                <PersonPicker small width={160} people={assignOptions(selDepts)} placeholder={t('work.assignTo')}
                  onPick={(p) => bulk({ assignee_id: p.id })} dropUp={false} />
              )}
              {canBulkPush && (
                <select className="input" style={{ width: 110, padding: '5px 8px', fontSize: 12 }}
                  value={bulkPrio} onChange={(e) => { setBulkPrio(e.target.value); if (e.target.value) bulk({ priority: e.target.value }) }}
                  aria-label="Set priority">
                  <option value="">{t('work.setPriority')}</option>
                  {['P1', 'P2', 'P3', 'P4'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              )}
              {canBulkPush && selDepts.size === 1 && (
                <select className="input" style={{ width: 140, padding: '5px 8px', fontSize: 12 }}
                  value={bulkTeam} onChange={(e) => { setBulkTeam(e.target.value); if (e.target.value) bulk({ team_id: e.target.value }) }}
                  aria-label="Move to team">
                  <option value="">{t('work.moveToTeam')}</option>
                  {teams.filter((t) => selDepts.has(t.dept)).map((t) => (
                    <option key={t.id} value={t.id}>{t.name}</option>
                  ))}
                </select>
              )}
              <select className="input" style={{ width: 140, padding: '5px 8px', fontSize: 12 }}
                value={bulkStatus} onChange={(e) => { setBulkStatus(e.target.value); if (e.target.value) bulk({ status: e.target.value }) }}
                aria-label="Transition">
                <option value="">{t('work.transition')}</option>
                {['triaged', 'in_progress', 'resolved', 'closed'].map((s) => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
              <span className="spacer" />
              <button className="clear" onClick={() => setSelected(new Set())}>{t('work.clearSelection')}</button>
            </div>
          )}

          <div className="qhead" role="row">
            <span>
              <input type="checkbox" className="ck" checked={allSelected} aria-label="Select all"
                onChange={() => setSelected(allSelected ? new Set() : new Set(visible.map((r) => r.id)))} />
            </span>
            <span>{t('work.colRef')}</span>
            <span>{t('work.colRequest')}</span>
            <span>{t('work.colAssignee')}</span>
            <span>
              <button onClick={() => setSort(sort === 'sla' ? 'newest' : 'sla')}>
                SLA {sort === 'sla' ? '↓' : ''}
              </button>
            </span>
            <span>{t('work.colStatus')}</span>
            <span />
          </div>

          {visible.map((r) => {
            const actions = NEXT_ACTIONS[r.status] ?? []
            const mine = r.assignee_id === uid
            const scope = pushScope(r)
            const canAct = mine || !r.assignee_id
            const menu = (
              <>
                {canAct && actions.length > 0 && <div className="menu-lbl">{t('work.move')}</div>}
                {canAct && actions.map((a) => (
                  <button key={a.to} className="menu-item" onClick={() => update(r.id, { status: a.to })}>
                    {a.label}
                  </button>
                ))}
                {!scope && !r.assignee_id && (
                  <button className="menu-item" onClick={() => update(r.id, { assignee_id: uid })}>{t('work.assignToMe')}</button>
                )}
                {!scope && mine && (
                  <button className="menu-item" onClick={() => update(r.id, { assignee_id: null })}>{t('work.handBack')}</button>
                )}
                {scope && (
                  <div style={{ padding: '2px 8px 6px' }}>
                    <div className="menu-lbl" style={{ padding: '4px 0 4px' }}>Assign to</div>
                    <PersonPicker
                      small width={180}
                      people={assignOptions(new Set([r.dept]), scope === 'team' && r.team_id ? new Set([r.team_id]) : undefined)}
                      value={r.assignee_id}
                      placeholder="Assign to…"
                      onPick={(p) => update(r.id, { assignee_id: p.id })}
                    />
                  </div>
                )}
                {scope === 'dept' && (
                  <div style={{ padding: '2px 8px 6px' }}>
                    <div className="menu-lbl" style={{ padding: '4px 0 4px' }}>Team</div>
                    <select
                      className="input" style={{ width: 180, padding: '4px 8px', fontSize: 12 }}
                      value={r.team_id ?? ''}
                      onChange={(e) => update(r.id, { team_id: e.target.value || null })}
                    >
                      <option value="">unrouted</option>
                      {teams.filter((t) => t.dept === r.dept).map((t) => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </>
            )
            return (
              <RequestRow
                key={r.id}
                row={r}
                meta={`${r.requester?.display_name ?? 'Unknown'} · ${r.team_id ? teamName.get(r.team_id) ?? 'team' : 'unrouted'}`}
                assignee={r.assignee?.display_name ?? null}
                onOpen={() => onOpen(r.id)}
                selectable
                selected={selected.has(r.id)}
                onToggleSelect={() => toggle(r.id)}
                menu={menu}
              />
            )
          })}
          {loaded && visible.length === 0 && !error && (
            <div className="row row-desc">
              {view === 'unrouted' ? t('work.unroutedClear') : t('work.queueClear')}
            </div>
          )}
          {!loaded && !error && <SkeletonRows n={6} />}
          <div className="hint" aria-hidden="true" style={{ padding: '8px 14px 10px' }}>
            <span><span className="kbd">J</span> <span className="kbd">K</span> move</span>
            <span><span className="kbd">Enter</span> open</span>
            <span><span className="kbd">X</span> select</span>
            <span><span className="kbd">A</span> assign to me</span>
            <span><span className="kbd">/</span> search</span>
          </div>
        </section>
      </div>
      )}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
