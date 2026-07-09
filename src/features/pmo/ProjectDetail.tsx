import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { PersonPicker } from '../../components/PersonPicker'
import { useAuth } from '../auth/AuthProvider'
import { Chip, SectionLabel } from '../../components/ui'
import { Chain, type ApprovalStep } from '../requests/Approvals'
import { STATUS_META, WbsTree, type Activity, type WbsAssignment, type WbsDependency } from './Wbs'
import { TimelineView, type BaselineDates } from './Timeline'
import { RiskRegister, scoreBand } from './RiskRegister'
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
  snapshot_json: Record<string, unknown> | null
}
interface RiskLite {
  id: string
  seq: number
  title: string
  score: number
  status: string
  impact_scope: number
  type: string
}
interface IssueLite { id: string; seq: number; title: string; severity: string; status: string }
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

type Tab = 'charter' | 'wbs' | 'baselines' | 'budget' | 'risks' | 'team'

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

const RAG_COLOR: Record<string, string> = {
  green: 'var(--green)', amber: 'var(--amber)', red: 'var(--red)', muted: 'var(--ink-3)',
}
const RAG_SOFT: Record<string, string> = {
  green: 'var(--green-soft)', amber: 'var(--amber-soft)', red: 'var(--red-soft)', muted: 'var(--line)',
}

function RagDot({ tone, title }: { tone: string; title: string }) {
  return (
    <span
      title={title}
      style={{
        width: 11, height: 11, borderRadius: '50%', display: 'inline-block',
        background: RAG_COLOR[tone], boxShadow: `0 0 0 3px ${RAG_SOFT[tone]}`,
      }}
    />
  )
}

const AV_TONE: Record<string, { bg: string; fg: string }> = {
  it: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  admin: { bg: 'var(--admin-soft)', fg: 'var(--admin)' },
}

function Av({ name, tone = 'it' }: { name: string; tone?: 'it' | 'admin' }) {
  const initials = name.split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
  const t = AV_TONE[tone]
  return (
    <span
      title={name}
      style={{
        width: 28, height: 28, borderRadius: '50%', background: t.bg, color: t.fg,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10.5, fontWeight: 600, flexShrink: 0,
      }}
    >
      {initials}
    </span>
  )
}

function Metric({ label, value, valueColor, sub, subColor, pct, title }: {
  label: string
  value: React.ReactNode
  valueColor?: string
  sub?: string
  subColor?: string
  pct?: number
  title?: string
}) {
  return (
    <div className="card" style={{ padding: '12px 15px', minWidth: 0 }} title={title}>
      <div className="klabel">{label}</div>
      <div style={{ fontFamily: 'var(--font-head)', fontSize: 21, fontWeight: 600, color: valueColor ?? 'var(--ink)', marginTop: 2 }}>
        {value}
      </div>
      {pct != null ? (
        <div style={{ height: 4, background: 'var(--surface)', borderRadius: 999, marginTop: 7 }}>
          <div style={{ height: 4, width: `${Math.min(100, Math.max(0, pct))}%`, background: 'var(--it)', borderRadius: 999 }} />
        </div>
      ) : sub ? (
        <div style={{ fontSize: 10.5, color: subColor ?? 'var(--muted)', marginTop: 5 }}>{sub}</div>
      ) : null}
    </div>
  )
}

function SectionCard({ label, action, onAction, children }: {
  label: string
  action?: string
  onAction?: () => void
  children: React.ReactNode
}) {
  return (
    <div className="card" style={{ padding: '14px 17px', minWidth: 0 }}>
      <div className="sechead">
        {label}
        <span style={{ flex: 1 }} />
        {onAction && <button className="card-link" onClick={onAction}>{action} →</button>}
      </div>
      {children}
    </div>
  )
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const ago = (iso: string) => {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  const d = Math.round(s / 86400)
  return d === 1 ? 'yesterday' : d < 7 ? `${d}d ago` : new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}
const fmtDay = (d: string, withYear: boolean) =>
  new Date(d + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}) })
const fmtRange = (s: string | null, e: string | null) =>
  s && e ? `${fmtDay(s, false)} → ${fmtDay(e, true)}` : s ? `${fmtDay(s, true)} → —` : e ? `— → ${fmtDay(e, true)}` : '—'

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
  const [subview, setSubview] = useState<Tab | null>(null)
  const [budgetLines, setBudgetLines] = useState<BudgetRow[]>([])
  const [risks, setRisks] = useState<RiskLite[]>([])
  const [issues, setIssues] = useState<IssueLite[]>([])
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
      .select('id, baseline_type, version, locked_at, revoked_at, revoke_reason, snapshot_json')
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
    supabase.from('budget_lines')
      .select('id, category, description, planned_amount, cost_center, po_request_id, po:requests!budget_lines_po_request_id_fkey(ref, status)')
      .eq('project_id', projectId)
      .then(({ data }) => setBudgetLines((data as unknown as BudgetRow[]) ?? []))
    supabase.from('pmo_risks')
      .select('id, seq, title, score, status, impact_scope, type')
      .eq('project_id', projectId).order('score', { ascending: false })
      .then(({ data }) => setRisks((data as RiskLite[]) ?? []))
    supabase.from('pmo_issues').select('id, seq, title, severity, status').eq('project_id', projectId).order('created_at')
      .then(({ data }) => setIssues((data as IssueLite[]) ?? []))
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
        t === 'schedule' ? {
          planned_start: project.planned_start, planned_end: project.planned_end,
          activities: activities
            .filter((w) => w.planned_start && w.planned_end)
            .map((w) => ({ id: w.id, start: w.planned_start, end: w.planned_end })),
        } :
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

  // ---- derived overview metrics ----
  const parentIds = new Set(activities.map((a) => a.parent_wbs_id).filter(Boolean))
  const leaves = activities.filter((a) => !parentIds.has(a.id))
  const weightOf = (a: Activity) => {
    if (a.planned_start && a.planned_end) {
      const d = (new Date(a.planned_end).getTime() - new Date(a.planned_start).getTime()) / 86400000 + 1
      if (d > 0) return d
    }
    return 1
  }
  const totalWeight = leaves.reduce((s, a) => s + weightOf(a), 0)
  const pctComplete = totalWeight > 0
    ? Math.round(leaves.reduce((s, a) => s + weightOf(a) * STATUS_META[a.status].pct, 0) / totalWeight)
    : 0
  const pctOf = (rootId: string): number => {
    const descend = (id: string): Activity[] => {
      const kids = activities.filter((a) => a.parent_wbs_id === id)
      if (kids.length === 0) return activities.filter((a) => a.id === id)
      return kids.flatMap((k) => descend(k.id))
    }
    const ls = descend(rootId)
    const w = ls.reduce((s, a) => s + weightOf(a), 0)
    return w > 0 ? Math.round(ls.reduce((s, a) => s + weightOf(a) * STATUS_META[a.status].pct, 0) / w) : 0
  }

  const activeBl = (t: string) => baselines.find((b) => b.baseline_type === t && !b.revoked_at) ?? null
  const schedBl = activeBl('schedule')
  const costBl = activeBl('cost')
  const schedSnap = (schedBl?.snapshot_json ?? null) as {
    planned_start?: string | null
    planned_end?: string | null
    activities?: { id: string; start: string; end: string }[]
  } | null
  const baselineDates: BaselineDates = {}
  for (const a of schedSnap?.activities ?? []) baselineDates[a.id] = { start: a.start, end: a.end }

  // SPI — earned schedule vs planned value from the schedule baseline's planned range
  let pvPct: number | null = null
  if (schedSnap?.planned_start && schedSnap?.planned_end) {
    const s = new Date(schedSnap.planned_start).getTime()
    const e = new Date(schedSnap.planned_end).getTime()
    if (e > s) pvPct = Math.min(1, Math.max(0, (Date.now() - s) / (e - s)))
  }
  const spi = pvPct != null && pvPct > 0 ? pctComplete / 100 / pvPct : null

  // CPI — EV = BAC × % complete; AC = committed spend (budget lines handed to Procurement)
  const plannedTotal = budgetLines.reduce((s, l) => s + l.planned_amount, 0)
  const snapBudget = (costBl?.snapshot_json as { estimated_budget?: number | null } | null)?.estimated_budget ?? null
  const bac = snapBudget ?? (plannedTotal > 0 ? plannedTotal : null)
  const acTotal = budgetLines.filter((l) => l.po_request_id).reduce((s, l) => s + l.planned_amount, 0)
  const cpi = costBl && bac != null && bac > 0 && acTotal > 0 ? ((pctComplete / 100) * bac) / acTotal : null

  const openRisks = risks.filter((r) => r.status !== 'closed')
  const highRisks = openRisks.filter((r) => r.score >= 15).length
  const openIssues = issues.filter((i) => i.status === 'open' || i.status === 'in_progress')
  const ragOf = (v: number | null) => (v == null ? 'muted' : v >= 0.95 ? 'green' : v >= 0.85 ? 'amber' : 'red')
  const scopeRag = openIssues.some((i) => i.severity === 'critical')
    ? 'red'
    : openRisks.some((r) => r.type === 'threat' && r.impact_scope >= 4) ? 'amber' : 'green'
  const scopeNote = scopeRag === 'red' ? 'open critical issue'
    : scopeRag === 'amber' ? 'open risk threatens scope (impact ≥ 4)' : 'no open scope threats'
  const sponsorName = project.created_by ? people.get(project.created_by) ?? null : null
  const topLevel = activities.filter((a) => !a.parent_wbs_id)
  const acPct = bac != null && bac > 0 ? Math.min(100, Math.round((acTotal / bac) * 100)) : 0
  const cpiWords = cpi == null
    ? 'CPI needs an approved cost baseline and committed spend.'
    : cpi >= 1.05 ? 'spending less than planned for the work done'
    : cpi >= 0.95 ? 'spending roughly to plan'
    : 'spending more than planned for the work done'

  return (
    <>
      <button className="btn" onClick={onBack} style={{ marginBottom: 14 }}>← Projects</button>
      <div className="card" style={{ padding: '16px 20px', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span className="mono" style={{ fontSize: 12, background: 'var(--it-soft)', color: 'var(--it)', borderRadius: 7, padding: '4px 9px', fontWeight: 500 }}>
            {project.code}
          </span>
          <span style={{ fontFamily: 'var(--font-head)', fontSize: 17, fontWeight: 600, color: 'var(--ink)' }}>{project.name}</span>
          {isPersonal && <Chip tone="it">Personal tracker</Chip>}
          <Chip tone={meta.tone}>{meta.label}</Chip>
          {project.origin_type === 'converted' && <Chip tone="muted">converted from a ticket</Chip>}
          <span style={{ flex: 1 }} />
          {!isPersonal && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11, color: 'var(--muted)' }}>
              Health
              <RagDot tone={ragOf(spi)} title={spi != null ? `Schedule — SPI ${spi.toFixed(2)}` : 'Schedule — requires approved baseline'} />
              <RagDot tone={ragOf(cpi)} title={cpi != null ? `Cost — CPI ${cpi.toFixed(2)}` : 'Cost — requires approved baseline'} />
              <RagDot tone={scopeRag} title={`Scope — ${scopeNote}`} />
            </span>
          )}
        </div>
        <div style={{ display: 'flex', gap: 26, flexWrap: 'wrap', marginTop: 14, paddingTop: 13, borderTop: '1px solid var(--line)' }}>
          {sponsorName && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Av name={sponsorName} tone="admin" />
              <div><div className="klabel">Sponsor</div><div className="kval">{sponsorName}</div></div>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Av name={project.pm?.display_name ?? '—'} tone="it" />
            <div><div className="klabel">Project manager</div><div className="kval">{project.pm?.display_name ?? 'Unassigned'}</div></div>
          </div>
          {!isPersonal && (
            <div>
              <div className="klabel">Department</div>
              <div className="kval">
                {project.department_scope.length > 0
                  ? project.department_scope.map((d) => DEPT_COLOR[d]?.label ?? d).join(', ')
                  : 'Cross-functional'}
              </div>
            </div>
          )}
          <div>
            <div className="klabel">Timeline</div>
            <div className="kval">{fmtRange(project.planned_start, project.planned_end)}</div>
          </div>
          {!isPersonal && (
            <>
              <div>
                <div className="klabel">Budget</div>
                <div className="kval mono">{charter?.estimated_budget != null ? `SAR ${charter.estimated_budget.toLocaleString()}` : '—'}</div>
              </div>
              <div>
                <div className="klabel">Charter</div>
                <div className="kval" style={{ color: charter?.status === 'approved' ? 'var(--green)' : charter?.status === 'rejected' ? 'var(--red)' : charter?.status === 'submitted' ? 'var(--amber)' : 'var(--muted)' }}>
                  {charter ? charter.status[0].toUpperCase() + charter.status.slice(1) : 'None'}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

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

      {subview !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
          <button className="btn" onClick={() => { setFocusActivity(null); setSubview(null) }}>← Overview</button>
          <span className="row-desc mono">
            {project.code} / {subview === 'wbs' ? 'Work breakdown' : subview[0].toUpperCase() + subview.slice(1)}
          </span>
        </div>
      )}

      {subview === null && isPersonal && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <TimelineView
            activities={activities}
            dependencies={dependencies}
            onOpen={(id) => setFocusActivity(id)}
          />
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
          <TeamTab projectId={project.id} team={team} assignments={assignments} activities={activities} canManage={canManage} onChanged={load} onError={setError} />
        </div>
      )}

      {subview === null && !isPersonal && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 12 }}>
            <Metric label="Complete" value={`${pctComplete}%`} pct={pctComplete} />
            <Metric
              label="Schedule (SPI)"
              value={spi != null ? spi.toFixed(2) : '—'}
              valueColor={RAG_COLOR[ragOf(spi)]}
              sub={spi == null ? 'requires baseline' : spi >= 0.95 ? 'on track' : spi >= 0.85 ? 'watch schedule' : 'behind schedule'}
              subColor={spi != null && spi < 0.95 ? RAG_COLOR[ragOf(spi)] : 'var(--muted)'}
              title={spi != null && pvPct != null ? `Earned ${pctComplete}% vs ${Math.round(pvPct * 100)}% planned by today` : 'requires approved baseline'}
            />
            <Metric
              label="Cost (CPI)"
              value={cpi != null ? cpi.toFixed(2) : '—'}
              valueColor={RAG_COLOR[ragOf(cpi)]}
              sub={cpi == null ? 'requires baseline' : cpi >= 0.95 ? 'on budget' : cpi >= 0.85 ? 'watch spend' : 'over budget'}
              subColor={cpi != null && cpi < 0.95 ? RAG_COLOR[ragOf(cpi)] : 'var(--muted)'}
              title={cpi != null && bac != null ? `EV ${Math.round((pctComplete / 100) * bac).toLocaleString()} / AC ${acTotal.toLocaleString()} SAR` : 'requires approved baseline'}
            />
            <Metric
              label="Risks / issues"
              value={<>{openRisks.length}{highRisks > 0 && <span style={{ fontSize: 12, color: 'var(--red)', fontWeight: 500 }}> ({highRisks} high)</span>}</>}
              sub={`${openIssues.length} issue${openIssues.length === 1 ? '' : 's'} open`}
            />
          </div>

          <div style={{ marginBottom: 12 }}>
            <TimelineView
              activities={activities}
              dependencies={dependencies}
              baselineDates={schedBl ? baselineDates : undefined}
              onOpen={(id) => { setFocusActivity(id); setSubview('wbs') }}
              headerExtra={
                <button className="card-link" style={{ marginRight: 12 }} onClick={() => setSubview('baselines')}>
                  Baselines{schedBl ? ` · v${schedBl.version}` : ''}
                </button>
              }
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <SectionCard label="Risks and issues" action="Open register" onAction={() => setSubview('risks')}>
              {(() => {
                const rShow = openRisks.slice(0, openIssues.length > 0 ? 2 : 3)
                const iShow = openIssues.slice(0, 3 - rShow.length)
                const rows = [
                  ...rShow.map((r) => ({ key: r.id, kind: 'risk' as const, r })),
                  ...iShow.map((i) => ({ key: i.id, kind: 'issue' as const, i })),
                ]
                if (rows.length === 0) return <div className="row-desc">No open risks or issues.</div>
                return rows.map((row, idx) => {
                  const last = idx === rows.length - 1
                  if (row.kind === 'risk') {
                    const r = row.r
                    const chip = r.score >= 15
                      ? { bg: 'var(--red)', fg: '#fff' }
                      : r.score >= 5 ? { bg: 'var(--amber-soft)', fg: 'var(--amber)' } : { bg: 'var(--green-soft)', fg: 'var(--green)' }
                    return (
                      <div key={row.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: last ? 'none' : '1px solid var(--line)' }}>
                        <span className="chip mono" style={{ background: chip.bg, color: chip.fg, fontSize: 10, borderRadius: 6 }}>{r.score}</span>
                        <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: r.score >= 15 ? 500 : 400, color: r.type === 'opportunity' ? 'var(--green)' : r.score >= 15 ? 'var(--ink)' : 'var(--text)' }}>
                          {r.title}{r.type === 'opportunity' ? ' ↗' : ''}
                        </span>
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>R-{String(r.seq).padStart(2, '0')}</span>
                      </div>
                    )
                  }
                  const i = row.i
                  return (
                    <div key={row.key} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '7px 0', borderBottom: last ? 'none' : '1px solid var(--line)' }}>
                      <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)', fontSize: 10, borderRadius: 6 }}>ISSUE</span>
                      <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text)' }}>{i.title}</span>
                      <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>I-{String(i.seq).padStart(2, '0')}</span>
                    </div>
                  )
                })
              })()}
            </SectionCard>

            <SectionCard label="Budget" action="Open budget" onAction={() => setSubview('budget')}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)' }}>
                <span>Committed</span>
                <span className="mono" style={{ color: 'var(--ink)', fontWeight: 500 }}>SAR {acTotal.toLocaleString()}</span>
              </div>
              <div style={{ height: 9, background: 'var(--surface)', borderRadius: 999, margin: '7px 0' }}>
                <div style={{ height: 9, width: `${acPct}%`, background: 'var(--amber)', borderRadius: 999 }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'var(--muted)' }}>
                <span>{acPct}% of {bac != null ? `SAR ${bac.toLocaleString()}` : '—'}</span>
                <span>{pctComplete}% work done</span>
              </div>
              <div style={{ fontSize: 11.5, marginTop: 8, fontWeight: 500, color: cpi == null ? 'var(--muted)' : RAG_COLOR[ragOf(cpi)] }}>
                {cpi == null ? cpiWords : `${cpiWords} — CPI ${cpi.toFixed(2)}`}
              </div>
            </SectionCard>

            <SectionCard label="Work breakdown" action="Open full WBS" onAction={() => setSubview('wbs')}>
              {topLevel.slice(0, 5).map((t) => {
                const p = pctOf(t.id)
                const kids = activities.filter((a) => a.parent_wbs_id === t.id).length
                return (
                  <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                    <span className="mono" style={{ fontSize: 10, color: 'var(--muted)' }}>{t.code}</span>
                    <span style={{ fontSize: 12.5, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.title}{kids > 0 ? ` (${kids} activit${kids === 1 ? 'y' : 'ies'})` : ''}
                    </span>
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: p === 100 ? 'var(--green)' : p > 0 ? 'var(--text)' : 'var(--muted)' }}>{p}%</span>
                  </div>
                )
              })}
              {topLevel.length === 0 && <div className="row-desc">No WBS yet.</div>}
            </SectionCard>

            <SectionCard label="Latest activity">
              {audit.slice(0, 5).map((e, idx) => {
                const last = idx === Math.min(5, audit.length) - 1
                const detail = e.area === 'status' && e.detail.from
                  ? ` ${e.detail.from} → ${e.detail.to}`
                  : e.detail.type ? ` ${e.detail.type} v${e.detail.version}` : ''
                return (
                  <div key={e.id} style={{ fontSize: 12, color: 'var(--text)', padding: '5px 0', borderBottom: last ? 'none' : '1px solid var(--line)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {e.actor?.display_name ? `${e.actor.display_name} — ` : ''}{cap(e.area)} {e.action}{detail}
                    <span style={{ color: 'var(--muted)' }}> · {ago(e.created_at)}</span>
                  </div>
                )
              })}
              {audit.length === 0 && <div className="row-desc">No audited events yet.</div>}
            </SectionCard>

            <SectionCard label="Charter" action="Open charter" onAction={() => setSubview('charter')}>
              {charter ? (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                    <Chip tone={charter.status === 'approved' ? 'green' : charter.status === 'rejected' ? 'red' : charter.status === 'submitted' ? 'amber' : 'muted'}>
                      {charter.status}
                    </Chip>
                    {charters.length > 1 && <Chip tone="muted">{charters.length} versions</Chip>}
                    <span style={{ flex: 1 }} />
                    <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                      {charter.estimated_budget != null ? `SAR ${charter.estimated_budget.toLocaleString()}` : ''}
                    </span>
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--text)', lineHeight: 1.5, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                    {charter.objective}
                  </div>
                </>
              ) : (
                <div className="row-desc">No charter yet.</div>
              )}
            </SectionCard>

            <SectionCard label="Team" action="Manage" onAction={() => setSubview('team')}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                {team.slice(0, 10).map((t) => t.member && <Av key={t.id} name={t.member.display_name} />)}
                {team.length === 0
                  ? <span className="row-desc">No one assigned yet.</span>
                  : <span className="klabel" style={{ marginLeft: 6 }}>{team.length} member{team.length === 1 ? '' : 's'}</span>}
              </div>
            </SectionCard>
          </div>
        </>
      )}

      {subview === 'charter' && !isPersonal && (
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

      {subview === 'wbs' && (
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

      {subview === 'baselines' && !isPersonal && (
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

      {subview === 'budget' && !isPersonal && (
        <BudgetTab projectId={project.id} canManage={canManage} charterApproved={charter?.status === 'approved'} onError={setError} />
      )}

      {subview === 'risks' && !isPersonal && (
        <RiskRegister projectId={project.id} canManage={canManage} onError={setError} />
      )}

      {subview === 'team' && (
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
