import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PersonPicker } from '../../components/PersonPicker'
import { useAuth } from '../auth/AuthProvider'
import { Chip, SectionLabel } from '../../components/ui'
import { Chain, type ApprovalStep } from '../requests/Approvals'
import { WbsTree, type Activity, type WbsAssignment, type WbsDependency } from './Wbs'
import { TimelineView } from './Timeline'
import {
  DEPT_COLOR, PORTAL_DEPTS, PROJECT_STATUS_META,
  type DeptCode, type Project, type ProjectCharter, type ProjectStatus,
} from '../../lib/types'

interface BaselineRow {
  id: string
  baseline_type: string
  version: number
  locked_at: string
  revoked_at: string | null
  revoke_reason: string | null
}
interface TeamRow {
  id: string
  allocation_percent: number
  role_on_project: string | null
  member: { id: string; display_name: string } | null
}
interface InternalStep {
  id: string
  step: 'dept_head' | 'committee'
  step_order: number
  target_dept: DeptCode | null
  decision: 'pending' | 'approved' | 'rejected' | 'info_requested'
  comment: string | null
}
interface BudgetRow {
  id: string
  category: string | null
  description: string
  planned_amount: number
  cost_center: string | null
  po_request_id: string | null
  po: { ref: string; status: string } | null
}
interface AuditRow {
  id: number
  area: string
  action: string
  detail: Record<string, string>
  created_at: string
  actor: { display_name: string } | null
}

type Tab = 'charter' | 'wbs' | 'timeline' | 'baselines' | 'budget' | 'team'

const COMPANY_ACTIONS: Partial<Record<ProjectStatus, { to: ProjectStatus; label: string; primary?: boolean }[]>> = {
  draft: [{ to: 'cancelled', label: 'Cancel project' }],
  charter_submitted: [{ to: 'cancelled', label: 'Cancel project' }],
  charter_approval: [{ to: 'cancelled', label: 'Cancel project' }],
  planning: [
    { to: 'baselined', label: 'Mark baselined', primary: true },
    { to: 'cancelled', label: 'Cancel project' },
  ],
  baselined: [
    { to: 'active', label: 'Activate project', primary: true },
    { to: 'cancelled', label: 'Cancel project' },
  ],
  active: [
    { to: 'on_hold', label: 'Put on hold' },
    { to: 'closing', label: 'Start closing' },
  ],
  on_hold: [{ to: 'active', label: 'Resume', primary: true }],
  closing: [{ to: 'closed', label: 'Close project', primary: true }],
}

const PERSONAL_ACTIONS: typeof COMPANY_ACTIONS = {
  draft: [
    { to: 'active', label: 'Start tracking', primary: true },
    { to: 'cancelled', label: 'Cancel' },
  ],
  active: [
    { to: 'on_hold', label: 'Pause' },
    { to: 'closing', label: 'Start closing' },
  ],
  on_hold: [{ to: 'active', label: 'Resume', primary: true }],
  closing: [{ to: 'closed', label: 'Close', primary: true }],
}

const ALL_STATUSES: ProjectStatus[] = [
  'draft', 'charter_submitted', 'charter_approval', 'planning', 'baselined',
  'active', 'on_hold', 'closing', 'closed', 'cancelled',
]

const STEP_LABEL = (s: InternalStep) =>
  s.step === 'dept_head'
    ? `${s.target_dept ? DEPT_COLOR[s.target_dept]?.label ?? s.target_dept : ''} department head`
    : 'PMO committee'

export function ProjectDetail({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { profile, hasRole } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [charters, setCharters] = useState<ProjectCharter[]>([])
  const [steps, setSteps] = useState<InternalStep[]>([])
  const [amICommittee, setAmICommittee] = useState(false)
  const [activities, setActivities] = useState<Activity[]>([])
  const [assignments, setAssignments] = useState<WbsAssignment[]>([])
  const [dependencies, setDependencies] = useState<WbsDependency[]>([])
  const [baselines, setBaselines] = useState<BaselineRow[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [team, setTeam] = useState<TeamRow[]>([])
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [tab, setTab] = useState<Tab | null>(null)
  const [focusActivity, setFocusActivity] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [correcting, setCorrecting] = useState(false)
  const [correctTo, setCorrectTo] = useState('')
  const [correctReason, setCorrectReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [comment, setComment] = useState('')
  // charter form
  const [objective, setObjective] = useState('')
  const [businessCase, setBusinessCase] = useState('')
  const [budget, setBudget] = useState('')
  const [duration, setDuration] = useState('')
  // edit form
  const [eName, setEName] = useState('')
  const [eDesc, setEDesc] = useState('')
  const [eStart, setEStart] = useState('')
  const [eEnd, setEEnd] = useState('')
  const [ePm, setEPm] = useState('')
  const [eScope, setEScope] = useState<DeptCode[]>([])

  const load = useCallback(() => {
    supabase
      .from('projects')
      .select('*, pm:profiles!projects_project_manager_id_fkey(display_name)')
      .eq('id', projectId)
      .single()
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setProject(data as unknown as Project)
      })
    supabase
      .from('project_charters').select('*')
      .eq('project_id', projectId).order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data as unknown as ProjectCharter[]) ?? []
        setCharters(rows)
        const current = rows[0]
        if (current) {
          supabase
            .from('project_approvals')
            .select('id, step, step_order, target_dept, decision, comment')
            .eq('charter_id', current.id)
            .order('step_order')
            .then(({ data: s }) => setSteps((s as unknown as InternalStep[]) ?? []))
        } else setSteps([])
      })
    supabase
      .from('wbs_elements')
      .select('id, parent_wbs_id, code, title, level, sequence, planned_start, planned_end, status, is_milestone')
      .eq('project_id', projectId).order('code')
      .then(({ data }) => {
        const acts = (data as unknown as Activity[]) ?? []
        setActivities(acts)
        if (acts.length) {
          const ids = acts.map((a) => a.id)
          supabase.from('wbs_assignments').select('id, wbs_element_id, user_id').in('wbs_element_id', ids)
            .then(({ data: d }) => setAssignments((d as WbsAssignment[]) ?? []))
          supabase.from('wbs_dependencies').select('id, predecessor_id, successor_id').in('successor_id', ids)
            .then(({ data: d }) => setDependencies((d as WbsDependency[]) ?? []))
        } else {
          setAssignments([]); setDependencies([])
        }
      })
    supabase
      .from('project_baselines')
      .select('id, baseline_type, version, locked_at, revoked_at, revoke_reason')
      .eq('project_id', projectId).order('baseline_type').order('version')
      .then(({ data }) => setBaselines((data as unknown as BaselineRow[]) ?? []))
    supabase
      .from('pmo_audit_events')
      .select('id, area, action, detail, created_at, actor:profiles(display_name)')
      .eq('project_id', projectId).order('id', { ascending: false }).limit(30)
      .then(({ data }) => setAudit((data as unknown as AuditRow[]) ?? []))
    supabase
      .from('resource_assignments')
      .select('id, allocation_percent, role_on_project, member:profiles!resource_assignments_user_id_fkey(id, display_name)')
      .eq('project_id', projectId)
      .then(({ data }) => setTeam((data as unknown as TeamRow[]) ?? []))
    supabase.from('profiles').select('id, display_name').eq('is_active', true)
      .then(({ data }) => setPeople(new Map((data ?? []).map((p) => [p.id, p.display_name]))))
  }, [projectId])

  useEffect(load, [load])

  useEffect(() => {
    if (!profile) return
    supabase.from('pmo_committee_members').select('id').eq('user_id', profile.id)
      .then(({ data }) => setAmICommittee((data ?? []).length > 0))
  }, [profile])

  if (!project) return error ? <p className="error-note">{error}</p> : <p className="page-sub">Loading…</p>

  const isPersonal = project.project_type === 'personal'
  const meta = PROJECT_STATUS_META[project.status]
  const isOwner = project.project_manager_id === profile?.id || project.created_by === profile?.id
  const canManage = isOwner || (!isPersonal && (hasRole('pmo_admin') || hasRole('system_admin')))
  const charter = charters[0] ?? null
  const tabs: Tab[] = isPersonal
    ? ['wbs', 'timeline', 'team']
    : ['charter', 'wbs', 'timeline', 'baselines', 'budget', 'team']
  const activeTab: Tab = tab && tabs.includes(tab) ? tab : tabs[0]
  const actions = (isPersonal ? PERSONAL_ACTIONS : COMPANY_ACTIONS)[project.status] ?? []
  const teamPeople = team.flatMap((t) => (t.member ? [{ id: t.member.id, display_name: t.member.display_name }] : []))

  const currentStep = steps.find((s) => s.decision === 'pending')
  const canDecide =
    charter?.status === 'submitted' && currentStep != null &&
    (currentStep.step === 'dept_head'
      ? hasRole('dept_head', currentStep.target_dept ?? undefined)
      : amICommittee)

  const transition = async (to: ProjectStatus) => {
    setError(null)
    const { error: e } = await supabase.from('projects').update({ status: to }).eq('id', project.id)
    if (e) setError(e.message)
    load()
  }

  const correctStatus = async () => {
    setError(null)
    const { error: e } = await supabase.rpc('pmo_correct_status', {
      p_project: project.id, p_status: correctTo, p_reason: correctReason,
    })
    if (e) setError(e.message)
    else { setCorrecting(false); setCorrectTo(''); setCorrectReason('') }
    load()
  }

  const startEdit = () => {
    setEName(project.name); setEDesc(project.description ?? '')
    setEStart(project.planned_start ?? ''); setEEnd(project.planned_end ?? '')
    setEPm(project.project_manager_id ?? ''); setEScope(project.department_scope)
    setEditing(true)
  }

  const saveEdit = async () => {
    setError(null)
    const { error: e } = await supabase.from('projects').update({
      name: eName.trim(),
      description: eDesc.trim() || null,
      planned_start: eStart || null,
      planned_end: eEnd || null,
      project_manager_id: ePm || null,
      department_scope: isPersonal ? [] : eScope,
    }).eq('id', project.id)
    if (e) setError(e.message)
    else setEditing(false)
    load()
  }

  const saveCharter = async () => {
    setError(null)
    const { error: e } = await supabase.from('project_charters').insert({
      project_id: project.id,
      objective: objective.trim(),
      business_case: businessCase.trim() || null,
      estimated_budget: budget ? Number(budget) : null,
      estimated_duration_days: duration ? Number(duration) : null,
    })
    if (e) setError(e.message)
    load()
  }

  const submitCharter = async () => {
    if (!charter) return
    setError(null)
    const { error: e } = await supabase.rpc('submit_charter', { p_charter: charter.id })
    if (e) setError(e.message)
    load()
  }

  const decideStep = async (decision: 'approved' | 'rejected') => {
    if (!currentStep) return
    setError(null)
    const { error: e } = await supabase.rpc('decide_project_approval', {
      p_approval: currentStep.id, p_decision: decision, p_comment: comment || null,
    })
    if (e) setError(e.message)
    setComment('')
    load()
  }

  const lockBaselines = async () => {
    setError(null)
    const active = baselines.filter((b) => !b.revoked_at)
    const nextVersion = (t: string) =>
      baselines.filter((b) => b.baseline_type === t).reduce((m, b) => Math.max(m, b.version), 0) + 1
    const missing = ['scope', 'schedule', 'cost'].filter((t) => !active.some((b) => b.baseline_type === t))
    if (missing.length === 0) return
    const { error: e } = await supabase.from('project_baselines').insert(missing.map((t) => ({
      project_id: project.id, baseline_type: t, version: nextVersion(t),
      snapshot_json:
        t === 'scope' ? { wbs: activities.map((w) => ({ code: w.code, title: w.title })) } :
        t === 'schedule' ? { planned_start: project.planned_start, planned_end: project.planned_end } :
        { estimated_budget: charter?.estimated_budget ?? null },
    })))
    if (e) setError(e.message)
    load()
  }

  const revokeBaseline = async (b: BaselineRow) => {
    const reason = window.prompt(`Reason for revoking ${b.baseline_type} v${b.version}? (required, audited)`)
    if (!reason?.trim()) return
    setError(null)
    const { error: e } = await supabase.rpc('revoke_baseline', { p_baseline: b.id, p_reason: reason.trim() })
    if (e) setError(e.message)
    load()
  }

  const hasAllBaselines = new Set(baselines.filter((b) => !b.revoked_at).map((b) => b.baseline_type)).size >= 3
  const chainSteps: ApprovalStep[] = steps.map((s) => ({
    id: s.id, request_id: '', step_order: s.step_order,
    approver_hint: STEP_LABEL(s), decision: s.decision, comment: s.comment,
  }))

  return (
    <>
      <button className="btn" onClick={onBack} style={{ marginBottom: 14 }}>← Projects</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 14, color: 'var(--ink)' }}>{project.code}</span>
        <h2 className="page-head" style={{ flex: 1, margin: 0 }}>{project.name}</h2>
        {isPersonal && <Chip tone="it">Personal tracker</Chip>}
        <Chip tone={meta.tone}>{meta.label}</Chip>
      </div>
      <p className="page-sub">
        PM: {project.pm?.display_name ?? 'unassigned'}
        {isPersonal
          ? ' · visible only to you and your team'
          : project.department_scope.length > 0
            ? ' · ' + project.department_scope.map((d) => DEPT_COLOR[d]?.label ?? d).join(', ')
            : ' · Cross-functional'}
        {project.origin_type === 'converted' ? ' · converted from a ticket' : ''}
      </p>

      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <button
              key={a.to}
              className={`btn${a.primary ? ' primary' : ''}`}
              onClick={() => transition(a.to)}
              disabled={a.to === 'baselined' && !hasAllBaselines}
              title={a.to === 'baselined' && !hasAllBaselines ? 'Lock scope, schedule and cost baselines first' : undefined}
            >
              {a.label}
            </button>
          ))}
          <span style={{ flex: 1 }} />
          <button className="btn" onClick={() => (editing ? setEditing(false) : startEdit())}>
            {editing ? 'Close edit' : 'Edit project'}
          </button>
          <button className="btn" onClick={() => setCorrecting(!correcting)}>Correct status</button>
        </div>
      )}

      {editing && canManage && (
        <div className="card" style={{ padding: 18, marginBottom: 16 }}>
          <SectionLabel>Edit project</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input className="input" value={eName} onChange={(e) => setEName(e.target.value)} placeholder="Project name" />
            <textarea className="input" rows={2} value={eDesc} onChange={(e) => setEDesc(e.target.value)} placeholder="Description" />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span className="row-desc">Planned</span>
              <input className="input" type="date" style={{ width: 150 }} value={eStart} onChange={(e) => setEStart(e.target.value)} />
              <span className="row-desc">→</span>
              <input className="input" type="date" style={{ width: 150 }} value={eEnd} onChange={(e) => setEEnd(e.target.value)} />
              <span className="row-desc" style={{ marginLeft: 12 }}>PM</span>
              <PersonPicker
                people={[{ id: '', display_name: '— unassigned —' }, ...[...people.entries()].map(([id, display_name]) => ({ id, display_name }))]}
                value={ePm || null} width={200} placeholder="Project manager…"
                onPick={(p) => setEPm(p.id)}
              />
            </div>
            {!isPersonal && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <span className="row-desc">Departments:</span>
                {PORTAL_DEPTS.map((d) => (
                  <Chip key={d} tone={eScope.includes(d) ? 'accent' : 'muted'}
                    onClick={() => setEScope((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))}>
                    {DEPT_COLOR[d].label}
                  </Chip>
                ))}
              </div>
            )}
            <div><button className="btn primary" onClick={saveEdit} disabled={!eName.trim()}>Save changes</button></div>
          </div>
        </div>
      )}

      {correcting && canManage && (
        <div className="card" style={{ padding: 18, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Chip tone="red">status correction</Chip>
          <span className="row-desc" style={{ minWidth: 180, flex: 1 }}>
            Fix a wrong status outside the normal lifecycle. A reason is required and the
            change is written to the audit log.
          </span>
          <select className="input" style={{ width: 180 }} value={correctTo} onChange={(e) => setCorrectTo(e.target.value)}>
            <option value="">Set status to…</option>
            {ALL_STATUSES.filter((s) => s !== project.status).map((s) => (
              <option key={s} value={s}>{PROJECT_STATUS_META[s].label}</option>
            ))}
          </select>
          <input className="input" style={{ flex: 2, minWidth: 200 }} placeholder="Reason (required)"
            value={correctReason} onChange={(e) => setCorrectReason(e.target.value)} />
          <button className="btn primary" onClick={correctStatus} disabled={!correctTo || correctReason.trim().length < 5}>
            Apply
          </button>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {tabs.map((t) => (
          <Chip key={t} tone={activeTab === t ? 'accent' : 'muted'} onClick={() => { setFocusActivity(null); setTab(t) }}>
            {t === 'wbs' ? 'WBS' : t[0].toUpperCase() + t.slice(1)}
          </Chip>
        ))}
      </div>

      {activeTab === 'charter' && !isPersonal && (
        <div className="card" style={{ padding: 18 }}>
          {!charter && (
            <>
              <SectionLabel>Charter — authorization by department head + PMO committee</SectionLabel>
              {canManage && project.status === 'draft' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <textarea className="input" rows={2} placeholder="Objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
                  <textarea className="input" rows={3} placeholder="Business case (optional)" value={businessCase} onChange={(e) => setBusinessCase(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" type="number" placeholder="Estimated budget (SAR)" value={budget} onChange={(e) => setBudget(e.target.value)} />
                    <input className="input" type="number" placeholder="Estimated duration (days)" value={duration} onChange={(e) => setDuration(e.target.value)} />
                  </div>
                  <div><button className="btn primary" onClick={saveCharter} disabled={!objective.trim()}>Save draft charter</button></div>
                </div>
              ) : (
                <div className="row-desc">No charter yet.</div>
              )}
            </>
          )}
          {charter && (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <SectionLabel>Charter</SectionLabel>
                <span style={{ flex: 1 }} />
                <Chip tone={charter.status === 'approved' ? 'green' : charter.status === 'rejected' ? 'red' : charter.status === 'submitted' ? 'amber' : 'muted'}>
                  {charter.status}
                </Chip>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '140px 1fr', rowGap: 8, columnGap: 12, fontSize: 13 }}>
                <span className="row-desc">Objective</span><span>{charter.objective}</span>
                <span className="row-desc">Business case</span><span>{charter.business_case ?? '—'}</span>
                <span className="row-desc">Estimated budget</span>
                <span className="mono">{charter.estimated_budget != null ? `${charter.estimated_budget.toLocaleString()} SAR` : '—'}</span>
                <span className="row-desc">Duration</span><span>{charter.estimated_duration_days != null ? `${charter.estimated_duration_days} days` : '—'}</span>
              </div>
              {chainSteps.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <SectionLabel>Approval — department head, then PMO committee</SectionLabel>
                  <Chain steps={chainSteps} />
                </div>
              )}
              {canDecide && currentStep && (
                <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
                  <input className="input" style={{ flex: 1 }} placeholder="Comment (optional)"
                    value={comment} onChange={(e) => setComment(e.target.value)} />
                  <button className="btn primary" onClick={() => decideStep('approved')}>
                    Approve as {STEP_LABEL(currentStep)}
                  </button>
                  <button className="btn" onClick={() => decideStep('rejected')}>Reject</button>
                </div>
              )}
              {canManage && charter.status === 'draft' && (
                <div style={{ marginTop: 14 }}>
                  <button className="btn primary" onClick={submitCharter}>Submit for approval</button>
                </div>
              )}
              {canManage && charter.status === 'rejected' && project.status === 'draft' && (
                <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <SectionLabel>Revise and resubmit</SectionLabel>
                  <textarea className="input" rows={2} placeholder="Revised objective" value={objective} onChange={(e) => setObjective(e.target.value)} />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <input className="input" type="number" placeholder="Revised budget (SAR)" value={budget} onChange={(e) => setBudget(e.target.value)} />
                    <button className="btn primary" onClick={saveCharter} disabled={!objective.trim()}>Save new draft</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'wbs' && (
        <WbsTree
          projectId={project.id}
          activities={activities}
          assignments={assignments}
          dependencies={dependencies}
          team={teamPeople}
          people={people}
          canManage={canManage}
          myId={profile?.id ?? null}
          focusId={focusActivity}
          onChanged={load}
          onError={setError}
        />
      )}

      {activeTab === 'timeline' && (
        <TimelineView
          activities={activities}
          dependencies={dependencies}
          onOpen={(id) => { setFocusActivity(id); setTab('wbs') }}
        />
      )}

      {activeTab === 'baselines' && !isPersonal && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <SectionLabel>Baselines — locked, versioned; revocable with an audited reason</SectionLabel>
            <span style={{ flex: 1 }} />
            {canManage && ['planning', 'baselined', 'active'].includes(project.status) && !hasAllBaselines && (
              <button className="btn primary" onClick={lockBaselines}>Lock missing baselines</button>
            )}
          </div>
          {baselines.map((b) => (
            <div key={b.id} style={{ display: 'flex', gap: 12, alignItems: 'center', padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: 13, opacity: b.revoked_at ? 0.6 : 1 }}>
              <Chip tone={b.revoked_at ? 'red' : 'ink'}>{b.baseline_type}</Chip>
              <span className="mono" style={{ textDecoration: b.revoked_at ? 'line-through' : 'none' }}>v{b.version}</span>
              <span className="row-desc">{new Date(b.locked_at).toLocaleString()}</span>
              {b.revoked_at ? (
                <span className="row-desc" style={{ flex: 1 }}>revoked — {b.revoke_reason}</span>
              ) : (
                <span style={{ flex: 1 }} />
              )}
              {canManage && !b.revoked_at && (
                <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => revokeBaseline(b)}>revoke</button>
              )}
            </div>
          ))}
          {baselines.length === 0 && <div className="row-desc">Nothing locked yet — baselining requires scope, schedule and cost.</div>}
          {audit.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <SectionLabel>Audit log</SectionLabel>
              {audit.map((e) => (
                <div key={e.id} style={{ display: 'flex', gap: 10, padding: '5px 0', borderTop: '1px solid var(--line)', fontSize: 12 }}>
                  <span className="mono row-desc" style={{ minWidth: 130 }}>{new Date(e.created_at).toLocaleString()}</span>
                  <Chip tone={e.action === 'revoked' || e.action === 'corrected' ? 'red' : 'muted'} style={{ fontSize: 10 }}>{e.area} {e.action}</Chip>
                  <span style={{ flex: 1 }}>
                    {e.actor?.display_name ?? '—'}
                    {e.area === 'status' && ` · ${e.detail.from} → ${e.detail.to}`}
                    {e.detail.type && ` · ${e.detail.type} v${e.detail.version}`}
                    {e.detail.reason && ` — "${e.detail.reason}"`}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'budget' && !isPersonal && (
        <BudgetTab projectId={project.id} canManage={canManage} charterApproved={charter?.status === 'approved'} onError={setError} />
      )}

      {activeTab === 'team' && (
        <TeamTab projectId={project.id} team={team} assignments={assignments} activities={activities} canManage={canManage} onChanged={load} onError={setError} />
      )}

      {error && <p className="error-note" style={{ marginTop: 12 }}>{error}</p>}
    </>
  )
}

function BudgetTab({ projectId, canManage, charterApproved, onError }: {
  projectId: string
  canManage: boolean
  charterApproved: boolean
  onError: (m: string) => void
}) {
  const [lines, setLines] = useState<BudgetRow[]>([])
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [costCenter, setCostCenter] = useState('')
  const [category, setCategory] = useState('')

  const load = useCallback(() => {
    supabase
      .from('budget_lines')
      .select('id, category, description, planned_amount, cost_center, po_request_id, po:requests!budget_lines_po_request_id_fkey(ref, status)')
      .eq('project_id', projectId)
      .order('created_at')
      .then(({ data }) => setLines((data as unknown as BudgetRow[]) ?? []))
  }, [projectId])

  useEffect(load, [load])

  const add = async () => {
    const { error: e } = await supabase.from('budget_lines').insert({
      project_id: projectId, description: desc.trim(), planned_amount: Number(amount),
      cost_center: costCenter.trim() || null, category: category.trim() || null,
    })
    if (e) onError(e.message)
    setDesc(''); setAmount(''); setCostCenter(''); setCategory('')
    load()
  }

  const raisePo = async (line: BudgetRow) => {
    const { error: e } = await supabase.rpc('create_po_request', { p_budget_line: line.id })
    if (e) onError(e.message)
    load()
  }

  const total = lines.reduce((s, l) => s + l.planned_amount, 0)

  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <SectionLabel>Budget — hands off to Procurement, never approves spend itself</SectionLabel>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 13 }}>{total.toLocaleString()} SAR planned</span>
      </div>
      {lines.map((l) => (
        <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
          <div style={{ flex: 1 }}>
            <div className="row-title">{l.description}</div>
            <div className="row-desc">{[l.category, l.cost_center].filter(Boolean).join(' · ') || '—'}</div>
          </div>
          <span className="mono">{l.planned_amount.toLocaleString()} SAR</span>
          {l.po ? (
            <Chip mono tone="green">{l.po.ref} · {l.po.status.replace('_', ' ')}</Chip>
          ) : canManage ? (
            <button className="btn" onClick={() => raisePo(l)} disabled={!charterApproved}
              title={charterApproved ? undefined : 'The charter must be approved first'}>
              Create PO request
            </button>
          ) : (
            <Chip tone="muted">no PO yet</Chip>
          )}
        </div>
      ))}
      {lines.length === 0 && <div className="row-desc">No budget lines yet.</div>}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <input className="input" style={{ flex: 2 }} placeholder="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
          <input className="input" style={{ width: 120 }} type="number" placeholder="SAR" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input className="input" style={{ width: 110 }} placeholder="Cost center" value={costCenter} onChange={(e) => setCostCenter(e.target.value)} />
          <input className="input" style={{ width: 110 }} placeholder="Category" value={category} onChange={(e) => setCategory(e.target.value)} />
          <button className="btn primary" onClick={add} disabled={!desc.trim() || !(Number(amount) > 0)}>Add line</button>
        </div>
      )}
    </div>
  )
}

function TeamTab({ projectId, team, assignments, activities, canManage, onChanged, onError }: {
  projectId: string
  team: TeamRow[]
  assignments: WbsAssignment[]
  activities: Activity[]
  canManage: boolean
  onChanged: () => void
  onError: (m: string) => void
}) {
  const [people, setPeople] = useState<{ id: string; display_name: string }[]>([])
  const [pick, setPick] = useState('')
  const [alloc, setAlloc] = useState('100')

  useEffect(() => {
    if (!canManage) return
    supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name')
      .then(({ data }) => setPeople(data ?? []))
  }, [canManage])

  const add = async () => {
    const { error: e } = await supabase.from('resource_assignments').insert({
      project_id: projectId, user_id: pick, allocation_percent: Number(alloc) || 100,
    })
    if (e) onError(e.message)
    setPick('')
    onChanged()
  }

  const remove = async (id: string) => {
    const { error: e } = await supabase.from('resource_assignments').delete().eq('id', id)
    if (e) onError(e.message)
    onChanged()
  }

  const doneOf = (uid: string) => {
    const mine = assignments.filter((a) => a.user_id === uid).map((a) => a.wbs_element_id)
    const acts = activities.filter((x) => mine.includes(x.id))
    return { total: acts.length, done: acts.filter((x) => x.status === 'done').length }
  }

  return (
    <div className="card" style={{ padding: 18 }}>
      <SectionLabel>Team — project membership; assign activities on the WBS tab</SectionLabel>
      {team.map((t) => {
        const w = t.member ? doneOf(t.member.id) : { total: 0, done: 0 }
        return (
          <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
            <span style={{ flex: 1 }}>{t.member?.display_name ?? '—'}</span>
            {t.role_on_project && <Chip tone="muted">{t.role_on_project}</Chip>}
            <Chip tone={w.total ? 'accent' : 'muted'}>{w.done}/{w.total} activities done</Chip>
            <span className="mono">{t.allocation_percent}%</span>
            {canManage && <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => remove(t.id)}>remove</button>}
          </div>
        )
      })}
      {team.length === 0 && <div className="row-desc">No one assigned yet.</div>}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <PersonPicker
            people={people.filter((p) => !team.some((t) => t.member?.id === p.id))}
            value={pick || null} flex={1} placeholder="Add a team member…"
            onPick={(p) => setPick(p.id)}
          />
          <input className="input" type="number" style={{ width: 90 }} value={alloc} onChange={(e) => setAlloc(e.target.value)} min={1} max={100} />
          <button className="btn primary" onClick={add} disabled={!pick}>Assign</button>
        </div>
      )}
    </div>
  )
}
