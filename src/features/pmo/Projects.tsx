import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Chip, MetricCard, SectionLabel } from '../../components/ui'
import {
  DEPT_COLOR, PORTAL_DEPTS, PROJECT_STATUS_META,
  type DeptCode, type Project, type ProjectStatus, type ProjectType,
} from '../../lib/types'

interface ConversionRow {
  id: string
  source_department: DeptCode
  status: string
  decision_notes: string | null
  requester: { display_name: string } | null
  proposed_pm: { display_name: string } | null
  request: { ref: string; title: string } | null
}

const OPEN_STATUSES: ProjectStatus[] = [
  'draft', 'charter_submitted', 'charter_approval', 'planning', 'baselined', 'active', 'on_hold', 'closing',
]

export function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const { profile, hasRole } = useAuth()
  const [items, setItems] = useState<Project[]>([])
  const [conversions, setConversions] = useState<ConversionRow[]>([])
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [view, setView] = useState<'projects' | 'console'>('projects')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<DeptCode[]>([])
  const [projectType, setProjectType] = useState<ProjectType>('company')
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDeptHead = hasRole('dept_head')
  const canConsole = hasRole('pmo_admin') || hasRole('system_admin')
  const canCreate =
    hasRole('project_manager') || hasRole('pmo_admin') || hasRole('agent') ||
    hasRole('team_lead') || hasRole('dept_head') || hasRole('system_admin')

  const load = useCallback(() => {
    supabase
      .from('projects')
      .select('*, pm:profiles!projects_project_manager_id_fkey(display_name)')
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setItems((data as unknown as Project[]) ?? [])
        setLoaded(true)
      })
    if (isDeptHead) {
      supabase
        .from('project_conversion_requests')
        .select(
          'id, source_department, status, decision_notes, requester:profiles!project_conversion_requests_requested_by_fkey(display_name), proposed_pm:profiles!project_conversion_requests_proposed_pm_id_fkey(display_name), request:requests!project_conversion_requests_source_request_id_fkey(ref, title)'
        )
        .eq('status', 'pending_dept_head')
        .then(({ data }) => setConversions((data as unknown as ConversionRow[]) ?? []))
    }
  }, [isDeptHead])

  useEffect(load, [load])

  const create = async () => {
    setError(null)
    const { data, error: e } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        project_type: projectType,
        department_scope: projectType === 'personal' ? [] : scope,
        project_manager_id: profile?.id ?? null,
      })
      .select('id')
      .single()
    if (e) { setError(e.message); return }
    setCreating(false)
    setName(''); setDescription(''); setScope([])
    if (data) onOpen(data.id)
  }

  const decideConversion = async (c: ConversionRow, approve: boolean) => {
    setError(null)
    const { error: e } = await supabase
      .from('project_conversion_requests')
      .update({ status: approve ? 'approved' : 'rejected' })
      .eq('id', c.id)
    if (e) setError(e.message)
    load()
  }

  const visible = filter === 'open' ? items.filter((p) => OPEN_STATUSES.includes(p.status)) : items
  const count = (ss: ProjectStatus[]) => items.filter((p) => ss.includes(p.status)).length

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <h2 className="page-head">{view === 'console' ? 'PMO console' : 'Projects'}</h2>
          <p className="page-sub">
            {view === 'console'
              ? 'Module-owned configuration — independent of the platform admin console.'
              : 'Company projects and personal trackers, managed by the PMO module.'}
          </p>
        </div>
        {canConsole && (
          <div style={{ display: 'flex', gap: 8, marginRight: 12 }}>
            <Chip tone={view === 'projects' ? 'accent' : 'muted'} onClick={() => setView('projects')}>Projects</Chip>
            <Chip tone={view === 'console' ? 'accent' : 'muted'} onClick={() => setView('console')}>PMO console</Chip>
          </div>
        )}
        {view === 'projects' && canCreate && (
          <button className="btn primary" onClick={() => setCreating(true)}>+ New project</button>
        )}
      </div>

      {view === 'console' && (
        <>
          <PmoConsole onError={setError} />
          {error && <p className="error-note">{error}</p>}
        </>
      )}
      {view === 'console' ? null : (
      <>
      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <MetricCard label="Active" value={count(['active'])} tone="green" />
        <MetricCard label="In planning" value={count(['planning', 'baselined'])} tone="accent" />
        <MetricCard label="Awaiting charter" value={count(['draft', 'charter_submitted', 'charter_approval'])} tone="amber" />
        <MetricCard label="On hold" value={count(['on_hold'])} tone="amber" />
      </div>

      {isDeptHead && conversions.length > 0 && (
        <div className="card" style={{ marginBottom: 18, padding: 18 }}>
          <SectionLabel>Conversion requests awaiting your decision</SectionLabel>
          {conversions.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <span className="mono" style={{ fontSize: 12 }}>{c.request?.ref}</span>
              <div style={{ flex: 1 }}>
                <div className="row-title">{c.request?.title}</div>
                <div className="row-desc">
                  raised by {c.requester?.display_name ?? '—'} · proposed PM {c.proposed_pm?.display_name ?? '—'}
                </div>
              </div>
              <Chip tone="muted">{DEPT_COLOR[c.source_department].label}</Chip>
              <button className="btn primary" onClick={() => decideConversion(c, true)}>Approve</button>
              <button className="btn" onClick={() => decideConversion(c, false)}>Reject</button>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div className="card" style={{ marginBottom: 18, padding: 18 }}>
          <SectionLabel>New project</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Chip tone={projectType === 'company' ? 'accent' : 'muted'} onClick={() => setProjectType('company')}>
                Company project
              </Chip>
              <Chip tone={projectType === 'personal' ? 'accent' : 'muted'} onClick={() => setProjectType('personal')}>
                Personal tracker
              </Chip>
              <span className="row-desc">
                {projectType === 'company'
                  ? 'Charter approved by the department head, then the PMO committee.'
                  : 'No approvals — private to you and people you invite.'}
              </span>
            </div>
            <input className="input" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea
              className="input" rows={2} placeholder="Description (optional)"
              value={description} onChange={(e) => setDescription(e.target.value)}
            />
            {projectType === 'company' && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="row-desc">Departments involved:</span>
              {PORTAL_DEPTS.map((d) => (
                <Chip
                  key={d}
                  tone={scope.includes(d) ? 'accent' : 'muted'}
                  onClick={() => setScope((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))}
                >
                  {DEPT_COLOR[d].label}
                </Chip>
              ))}
              <span className="row-desc">(none = cross-functional)</span>
            </div>
            )}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={create} disabled={!name.trim()}>Create draft</button>
              <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <Chip tone={filter === 'open' ? 'accent' : 'muted'} onClick={() => setFilter('open')}>Open</Chip>
        <Chip tone={filter === 'all' ? 'accent' : 'muted'} onClick={() => setFilter('all')}>All</Chip>
      </div>

      {visible.map((p) => {
        const meta = PROJECT_STATUS_META[p.status]
        return (
          <div
            className="card" key={p.id}
            style={{ marginBottom: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            onClick={() => onOpen(p.id)}
          >
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink)', width: 68 }}>{p.code}</span>
            <div style={{ flex: 1 }}>
              <div className="row-title">{p.name}</div>
              <div className="row-desc">
                PM: {p.pm?.display_name ?? 'unassigned'}
                {p.origin_type === 'converted' ? ' · converted from a ticket' : ''}
              </div>
            </div>
            {p.project_type === 'personal' ? (
              <Chip tone="it">Personal</Chip>
            ) : p.department_scope.length === 0 ? (
              <Chip tone="muted">Cross-functional</Chip>
            ) : (
              p.department_scope.map((d) => <Chip key={d} tone="muted">{DEPT_COLOR[d]?.label ?? d}</Chip>)
            )}
            <Chip tone={meta.tone}>{meta.label}</Chip>
          </div>
        )
      })}
      {loaded && visible.length === 0 && !error && (
        <div className="card"><div className="row row-desc">No projects yet.</div></div>
      )}
      {!loaded && !error && <p className="page-sub">Loading…</p>}
      {error && <p className="error-note">{error}</p>}
      </>
      )}
    </>
  )
}

/** PMO console — module-owned configuration, independent of the platform admin console. */
function PmoConsole({ onError }: { onError: (m: string) => void }) {
  const [members, setMembers] = useState<{ id: string; member: { id: string; display_name: string } | null }[]>([])
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([])
  const [pick, setPick] = useState('')

  const load = useCallback(() => {
    supabase
      .from('pmo_committee_members')
      .select('id, member:profiles!pmo_committee_members_user_id_fkey(id, display_name)')
      .then(({ data }) => setMembers((data as never) ?? []))
    supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name')
      .then(({ data }) => setPeople(data ?? []))
  }, [])

  useEffect(load, [load])

  const add = async () => {
    const { error: e } = await supabase.from('pmo_committee_members').insert({ user_id: pick })
    if (e) onError(e.message)
    setPick('')
    load()
  }
  const remove = async (id: string) => {
    const { error: e } = await supabase.from('pmo_committee_members').delete().eq('id', id)
    if (e) onError(e.message)
    load()
  }

  return (
    <div className="card" style={{ marginTop: 18, padding: 18 }}>
      <SectionLabel>PMO console — project committee</SectionLabel>
      <p className="row-desc" style={{ marginBottom: 10 }}>
        Company projects are approved by the department head, then by any member of this
        committee. Membership is managed here, independent of platform roles.
      </p>
      {members.map((m) => (
        <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
          <span style={{ flex: 1 }}>{m.member?.display_name ?? '—'}</span>
          <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => remove(m.id)}>remove</button>
        </div>
      ))}
      {members.length === 0 && <div className="row-desc">No committee members yet.</div>}
      <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
        <select className="input" style={{ flex: 1 }} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">Add a committee member…</option>
          {people.filter((p) => !members.some((m) => m.member?.id === p.id)).map((p) => (
            <option key={p.id} value={p.id}>{p.display_name}</option>
          ))}
        </select>
        <button className="btn primary" onClick={add} disabled={!pick}>Add</button>
      </div>
    </div>
  )
}
