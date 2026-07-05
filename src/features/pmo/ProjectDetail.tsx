import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Chip, SectionLabel } from '../../components/ui'
import { Chain, type ApprovalStep } from '../requests/Approvals'
import {
  DEPT_COLOR, PROJECT_STATUS_META,
  type Project, type ProjectCharter, type ProjectStatus,
} from '../../lib/types'

interface WbsRow { id: string; code: string; title: string; level: number }
interface BaselineRow { id: string; baseline_type: string; version: number; locked_at: string }
interface TeamRow {
  id: string
  allocation_percent: number
  role_on_project: string | null
  member: { id: string; display_name: string } | null
}

type Tab = 'charter' | 'wbs' | 'baselines' | 'team'

/** PM-driven transitions; guarded server-side by projects_guard_update. */
const ACTIONS: Partial<Record<ProjectStatus, { to: ProjectStatus; label: string; primary?: boolean }[]>> = {
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

export function ProjectDetail({ projectId, onBack }: { projectId: string; onBack: () => void }) {
  const { profile, hasRole } = useAuth()
  const [project, setProject] = useState<Project | null>(null)
  const [charters, setCharters] = useState<ProjectCharter[]>([])
  const [steps, setSteps] = useState<ApprovalStep[]>([])
  const [wbs, setWbs] = useState<WbsRow[]>([])
  const [baselines, setBaselines] = useState<BaselineRow[]>([])
  const [team, setTeam] = useState<TeamRow[]>([])
  const [tab, setTab] = useState<Tab>('charter')
  const [error, setError] = useState<string | null>(null)
  // charter form
  const [objective, setObjective] = useState('')
  const [businessCase, setBusinessCase] = useState('')
  const [budget, setBudget] = useState('')
  const [duration, setDuration] = useState('')

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
      .from('project_charters')
      .select('*')
      .eq('project_id', projectId)
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        const rows = (data as unknown as ProjectCharter[]) ?? []
        setCharters(rows)
        const current = rows[0]
        if (current && current.status !== 'draft') {
          supabase
            .from('approvals')
            .select('id, request_id, step_order, approver_hint, decision, comment')
            .eq('subject_type', 'project_charter')
            .eq('subject_id', current.id)
            .order('step_order')
            .then(({ data: s }) => setSteps((s as unknown as ApprovalStep[]) ?? []))
        } else setSteps([])
      })
    supabase
      .from('wbs_elements').select('id, code, title, level')
      .eq('project_id', projectId).order('code')
      .then(({ data }) => setWbs((data as unknown as WbsRow[]) ?? []))
    supabase
      .from('project_baselines').select('id, baseline_type, version, locked_at')
      .eq('project_id', projectId).order('baseline_type').order('version')
      .then(({ data }) => setBaselines((data as unknown as BaselineRow[]) ?? []))
    supabase
      .from('resource_assignments')
      .select('id, allocation_percent, role_on_project, member:profiles!resource_assignments_user_id_fkey(id, display_name)')
      .eq('project_id', projectId)
      .then(({ data }) => setTeam((data as unknown as TeamRow[]) ?? []))
  }, [projectId])

  useEffect(load, [load])

  if (!project) return error ? <p className="error-note">{error}</p> : <p className="page-sub">Loading…</p>

  const meta = PROJECT_STATUS_META[project.status]
  const isPm = project.project_manager_id === profile?.id || project.created_by === profile?.id
  const canManage = isPm || hasRole('pmo_admin') || hasRole('system_admin')
  const charter = charters[0] ?? null

  const transition = async (to: ProjectStatus) => {
    setError(null)
    const { error: e } = await supabase.from('projects').update({ status: to }).eq('id', project.id)
    if (e) setError(e.message)
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

  const lockBaselines = async () => {
    setError(null)
    const nextVersion = (t: string) =>
      baselines.filter((b) => b.baseline_type === t).reduce((m, b) => Math.max(m, b.version), 0) + 1
    const { error: e } = await supabase.from('project_baselines').insert([
      {
        project_id: project.id, baseline_type: 'scope', version: nextVersion('scope'),
        snapshot_json: { wbs: wbs.map((w) => ({ code: w.code, title: w.title })) },
      },
      {
        project_id: project.id, baseline_type: 'schedule', version: nextVersion('schedule'),
        snapshot_json: { planned_start: project.planned_start, planned_end: project.planned_end },
      },
      {
        project_id: project.id, baseline_type: 'cost', version: nextVersion('cost'),
        snapshot_json: { estimated_budget: charter?.estimated_budget ?? null },
      },
    ])
    if (e) setError(e.message)
    load()
  }

  const addWbs = async (parent: WbsRow | null) => {
    const siblings = wbs.filter((w) =>
      parent ? w.code.startsWith(parent.code + '.') && w.level === parent.level + 1 : w.level === 1
    )
    const code = parent
      ? `${parent.code}.${siblings.length + 1}`
      : `${siblings.length + 1}`
    const title = window.prompt(`Title for WBS ${code}`)
    if (!title?.trim()) return
    const { error: e } = await supabase.from('wbs_elements').insert({
      project_id: project.id,
      parent_wbs_id: parent?.id ?? null,
      code,
      title: title.trim(),
      level: parent ? parent.level + 1 : 1,
      sequence: siblings.length + 1,
    })
    if (e) setError(e.message)
    load()
  }

  const hasAllBaselines = new Set(baselines.map((b) => b.baseline_type)).size >= 3

  return (
    <>
      <button className="btn" onClick={onBack} style={{ marginBottom: 14 }}>← Projects</button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <span className="mono" style={{ fontSize: 14, color: 'var(--ink)' }}>{project.code}</span>
        <h2 className="page-head" style={{ flex: 1, margin: 0 }}>{project.name}</h2>
        <Chip tone={meta.tone}>{meta.label}</Chip>
      </div>
      <p className="page-sub">
        PM: {project.pm?.display_name ?? 'unassigned'}
        {project.department_scope.length > 0
          ? ' · ' + project.department_scope.map((d) => DEPT_COLOR[d]?.label ?? d).join(', ')
          : ' · Cross-functional'}
        {project.origin_type === 'converted' ? ' · converted from a ticket' : ''}
      </p>

      {canManage && (ACTIONS[project.status] ?? []).length > 0 && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(ACTIONS[project.status] ?? []).map((a) => (
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
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        {(['charter', 'wbs', 'baselines', 'team'] as Tab[]).map((t) => (
          <Chip key={t} tone={tab === t ? 'accent' : 'muted'} onClick={() => setTab(t)}>
            {t === 'wbs' ? 'WBS' : t[0].toUpperCase() + t.slice(1)}
          </Chip>
        ))}
      </div>

      {tab === 'charter' && (
        <div className="card" style={{ padding: 18 }}>
          {!charter && (
            <>
              <SectionLabel>Charter — formal authorization (DoA-gated)</SectionLabel>
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
                {charter.doa_tier && <Chip mono tone="ink">{charter.doa_tier}</Chip>}
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
              {steps.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <SectionLabel>Approval chain (Procurement DoA)</SectionLabel>
                  <Chain steps={steps} />
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

      {tab === 'wbs' && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <SectionLabel>Work Breakdown Structure</SectionLabel>
            <span style={{ flex: 1 }} />
            {canManage && <button className="btn" onClick={() => addWbs(null)}>+ Top-level element</button>}
          </div>
          {wbs.map((w) => (
            <div key={w.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', paddingLeft: (w.level - 1) * 22, borderTop: '1px solid var(--line)' }}>
              <span className="mono" style={{ fontSize: 12, color: 'var(--accent)' }}>{w.code}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{w.title}</span>
              {canManage && (
                <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => addWbs(w)}>+ child</button>
              )}
            </div>
          ))}
          {wbs.length === 0 && <div className="row-desc">No WBS elements yet. Tasks and scheduling arrive with the next phase.</div>}
        </div>
      )}

      {tab === 'baselines' && (
        <div className="card" style={{ padding: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <SectionLabel>Baselines — locked, versioned snapshots</SectionLabel>
            <span style={{ flex: 1 }} />
            {canManage && project.status === 'planning' && (
              <button className="btn primary" onClick={lockBaselines}>Lock scope + schedule + cost</button>
            )}
          </div>
          {baselines.map((b) => (
            <div key={b.id} style={{ display: 'flex', gap: 12, padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
              <Chip tone="ink">{b.baseline_type}</Chip>
              <span className="mono">v{b.version}</span>
              <span className="row-desc">{new Date(b.locked_at).toLocaleString()}</span>
            </div>
          ))}
          {baselines.length === 0 && <div className="row-desc">Nothing locked yet — baselining requires scope, schedule and cost.</div>}
        </div>
      )}

      {tab === 'team' && (
        <TeamTab projectId={project.id} team={team} canManage={canManage} onChanged={load} onError={setError} />
      )}

      {error && <p className="error-note" style={{ marginTop: 12 }}>{error}</p>}
    </>
  )
}

function TeamTab({ projectId, team, canManage, onChanged, onError }: {
  projectId: string
  team: TeamRow[]
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

  return (
    <div className="card" style={{ padding: 18 }}>
      <SectionLabel>Team — resource assignments</SectionLabel>
      {team.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderTop: '1px solid var(--line)', fontSize: 13 }}>
          <span style={{ flex: 1 }}>{t.member?.display_name ?? '—'}</span>
          {t.role_on_project && <Chip tone="muted">{t.role_on_project}</Chip>}
          <span className="mono">{t.allocation_percent}%</span>
          {canManage && <button className="btn" style={{ padding: '2px 8px', fontSize: 11 }} onClick={() => remove(t.id)}>remove</button>}
        </div>
      ))}
      {team.length === 0 && <div className="row-desc">No one assigned yet.</div>}
      {canManage && (
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <select className="input" style={{ flex: 1 }} value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">Add a team member…</option>
            {people.filter((p) => !team.some((t) => t.member?.id === p.id)).map((p) => (
              <option key={p.id} value={p.id}>{p.display_name}</option>
            ))}
          </select>
          <input className="input" type="number" style={{ width: 90 }} value={alloc} onChange={(e) => setAlloc(e.target.value)} min={1} max={100} />
          <button className="btn primary" onClick={add} disabled={!pick}>Assign</button>
        </div>
      )}
    </div>
  )
}
