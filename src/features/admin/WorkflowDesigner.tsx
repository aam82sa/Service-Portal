import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { WorkflowCanvas } from './WorkflowCanvas'
import { DEPT_COLOR, type Service } from '../../lib/types'
import {
  analyzeWorkflow,
  type WorkflowGraph,
  type WorkflowStatus,
  type WorkflowStepDef,
  type WorkflowTransition,
} from '../../lib/workflowValidate'

type Status = WorkflowStatus

const STATUSES: Status[] = [
  'new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester',
  'escalated', 'resolved', 'closed', 'cancelled',
]
const MAIN_PATH: Status[] = ['new', 'triaged', 'in_progress', 'pending_approval', 'resolved', 'closed']

const STATUS_DOT: Record<Status, string> = {
  new: 'var(--it)', triaged: 'var(--admin)', in_progress: 'var(--amber)',
  pending_approval: 'var(--accent)', pending_requester: 'var(--amber)',
  escalated: 'var(--red)', resolved: 'var(--green)', closed: 'var(--muted)',
  cancelled: 'var(--muted)',
}

const TRIGGER_CATALOG = [
  'ack email', 'start SLA', 'pause SLA', 'auto-assign', 'DoA chain', 'notify team lead', 'CSAT survey',
]

type Transition = WorkflowTransition
type StepDef = WorkflowStepDef
type Graph = WorkflowGraph

const DEFAULT_TRANSITIONS: Transition[] = [
  { from: 'new', to: 'triaged' }, { from: 'new', to: 'cancelled' },
  { from: 'triaged', to: 'in_progress' },
  { from: 'in_progress', to: 'pending_approval' }, { from: 'in_progress', to: 'pending_requester' },
  { from: 'in_progress', to: 'resolved' }, { from: 'in_progress', to: 'escalated' },
  { from: 'pending_requester', to: 'in_progress' }, { from: 'pending_approval', to: 'in_progress' },
  { from: 'escalated', to: 'in_progress' },
  { from: 'resolved', to: 'closed' }, { from: 'resolved', to: 'in_progress' },
]

const DEFAULT_TRIGGERS: Partial<Record<Status, string[]>> = {
  new: ['ack email', 'start SLA'],
  triaged: ['auto-assign'],
  pending_approval: ['DoA chain', 'pause SLA'],
  pending_requester: ['pause SLA'],
  escalated: ['notify team lead'],
  resolved: ['CSAT survey'],
}

function defaultGraph(): Graph {
  return {
    steps: STATUSES.map((s) => ({ id: s, triggers: DEFAULT_TRIGGERS[s] ?? [] })),
    transitions: [...DEFAULT_TRANSITIONS],
  }
}

interface SvcRow extends Service { requires_approval: boolean }

export function WorkflowDesigner() {
  const { hasRole } = useAuth()
  const [services, setServices] = useState<SvcRow[]>([])
  const [serviceId, setServiceId] = useState('')
  const [graph, setGraph] = useState<Graph>(defaultGraph())
  const [version, setVersion] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // WORKFL1 branch 1: read-only status-node canvas, off by default, shown
  // alongside the matrix. Editing/validation/properties land in branches 2–5.
  const [showCanvas, setShowCanvas] = useState(false)

  useEffect(() => {
    supabase
      .from('services')
      .select('id, dept, code, name, description, requires_approval')
      .eq('is_active', true)
      .order('dept')
      .order('name')
      .then(({ data, error: e }) => {
        if (e) return setError(e.message)
        const editable = ((data as SvcRow[]) ?? []).filter(
          (s) => hasRole('system_admin') || hasRole('dept_admin', s.dept)
        )
        setServices(editable)
        if (editable.length > 0) loadWorkflow(editable[0].id)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasRole])

  const service = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId])

  // WORKFL1 branch 2: validation runs on every edit, not on a button.
  const spawnsChildren = useMemo(
    () => graph.steps.some((s) => s.triggers.some((t) => /spawn/i.test(t))),
    [graph],
  )
  const issues = useMemo(
    () => analyzeWorkflow(graph, { requiresApproval: service?.requires_approval, spawnsChildren }),
    [graph, service, spawnsChildren],
  )
  const errors = issues.filter((i) => i.severity === 'error')
  const warnings = issues.filter((i) => i.severity === 'warning')
  const errorSteps = useMemo(
    () => new Set(errors.map((e) => e.nodeId).filter(Boolean) as WorkflowStatus[]),
    [errors],
  )
  const closedReachable = !errors.some((e) => e.message.startsWith('Closed is not reachable'))

  const loadWorkflow = async (id: string) => {
    setServiceId(id)
    setDirty(false)
    setError(null)
    const { data } = await supabase
      .from('workflow_definitions')
      .select('version, graph')
      .eq('service_id', id)
      .eq('status', 'published')
      .order('version', { ascending: false })
      .limit(1)
    if (data && data.length > 0) {
      setVersion(data[0].version as number)
      setGraph(data[0].graph as Graph)
    } else {
      setVersion(null)
      setGraph(defaultGraph())
    }
  }

  const has = (from: Status, to: Status) =>
    graph.transitions.some((t) => t.from === from && t.to === to)

  const toggleTransition = (from: Status, to: Status) => {
    setGraph((g) => ({
      ...g,
      transitions: has(from, to)
        ? g.transitions.filter((t) => !(t.from === from && t.to === to))
        : [...g.transitions, { from, to }],
    }))
    setDirty(true)
  }

  const toggleTrigger = (step: Status, trig: string) => {
    setGraph((g) => ({
      ...g,
      steps: g.steps.map((s) =>
        s.id === step
          ? {
              ...s,
              triggers: s.triggers.includes(trig)
                ? s.triggers.filter((t) => t !== trig)
                : [...s.triggers, trig],
            }
          : s
      ),
    }))
    setDirty(true)
  }

  const publish = async () => {
    if (errors.length > 0) return
    setError(null)
    const { data, error: e } = await supabase.rpc('publish_workflow', {
      p_service: serviceId,
      p_graph: graph,
    })
    if (e) setError(e.message)
    else {
      setVersion(data as number)
      setDirty(false)
    }
  }

  if (services.length === 0) return <p className="page-sub">{error ?? 'No services you can edit.'}</p>
  const c = service ? DEPT_COLOR[service.dept] : null

  return (
    <>
      <h2 className="page-head">Workflow designer</h2>
      <p className="page-sub">
        The published workflow is what the database enforces — a transition removed here is
        rejected server-side, buttons or not.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <select className="input" style={{ maxWidth: 340 }} value={serviceId} onChange={(e) => loadWorkflow(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.dept} · {s.code} — {s.name}
            </option>
          ))}
        </select>
        <span className="chip" style={{ background: version ? 'var(--green-soft)' : 'var(--surface)', color: version ? 'var(--green)' : 'var(--muted)' }}>
          {version ? `v${version} published` : 'platform defaults'}
        </span>
        {dirty && (
          <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>
            unpublished changes
          </span>
        )}
        <button
          className={`btn${showCanvas ? ' primary' : ''}`}
          style={{ marginLeft: 'auto' }}
          onClick={() => setShowCanvas((v) => !v)}
          aria-pressed={showCanvas}
          title="Preview the new status-node canvas (beta)"
        >
          {showCanvas ? 'Canvas ✓' : 'Canvas (beta)'}
        </button>
        {errors.length > 0 && (
          <span className="chip t-red">{errors.length} error{errors.length === 1 ? '' : 's'} block publish</span>
        )}
        <button
          className="btn primary"
          onClick={publish}
          disabled={!dirty || errors.length > 0}
          title={errors.length > 0 ? 'Fix the validation errors before publishing' : undefined}
        >
          Publish
        </button>
      </div>

      {/* live validation — runs on every edit, not on a button */}
      <div className="wfd" style={{ marginBottom: 14 }}>
        <div className="valbar" role="status" aria-label="Live validation" style={{ borderRadius: 'var(--radius)', border: '1px solid var(--line)' }}>
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--muted)', marginInlineEnd: 2 }}>
            Validation
          </span>
          {errors.map((e, i) => (
            <span className="vitem err" key={`e${i}`}><span className="vmark e">!</span>{e.message}</span>
          ))}
          {warnings.map((w, i) => (
            <span className="vitem warn" key={`w${i}`}><span className="vmark w">•</span>{w.message}</span>
          ))}
          {errors.length === 0 && warnings.length === 0 && (
            <span className="vitem" style={{ color: 'var(--green)' }}>All guardrails satisfied.</span>
          )}
          <span className="tool-spacer" />
          {closedReachable && <span className="chip t-green">Closed reachable from New</span>}
        </div>
      </div>

      {showCanvas && (
        <div style={{ marginBottom: 14 }}>
          <WorkflowCanvas graph={graph} requiresApproval={service?.requires_approval} errorSteps={errorSteps} />
        </div>
      )}

      <div className="card" style={{ padding: 16, marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          {MAIN_PATH.map((s, i) => (
            <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {i > 0 && (
                <span
                  style={{
                    color: has(MAIN_PATH[i - 1], s) ? 'var(--ink)' : 'var(--line)',
                    fontSize: 16,
                  }}
                >
                  →
                </span>
              )}
              <span
                className="chip"
                style={{
                  background: 'var(--card)',
                  border: '1.5px solid var(--line)',
                  color: 'var(--ink)',
                  display: 'inline-flex',
                  gap: 6,
                  alignItems: 'center',
                  padding: '5px 10px',
                }}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STATUS_DOT[s] }} />
                {s.replace('_', ' ')}
              </span>
            </span>
          ))}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>
          Side paths: pending requester · escalated · cancelled — edit all transitions below.
        </div>
      </div>


      <div className="card">
        {STATUSES.map((from) => {
          const step = graph.steps.find((s) => s.id === from)
          return (
            <div className="row" key={from} style={{ alignItems: 'flex-start' }}>
              <span
                className="chip"
                style={{
                  background: 'var(--surface)', color: 'var(--ink)', width: 128,
                  display: 'inline-flex', gap: 6, alignItems: 'center', marginTop: 2,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: STATUS_DOT[from] }} />
                {from.replace('_', ' ')}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 2, marginTop: 3 }}>→</span>
                  {STATUSES.filter((to) => to !== from).map((to) => (
                    <button
                      key={to}
                      className="chip"
                      onClick={() => toggleTransition(from, to)}
                      style={{
                        cursor: 'pointer', border: 'none',
                        background: has(from, to) ? 'var(--accent-soft)' : 'var(--surface)',
                        color: has(from, to) ? 'var(--accent)' : 'var(--muted)',
                        opacity: has(from, to) ? 1 : 0.7,
                      }}
                    >
                      {to.replace('_', ' ')}
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginRight: 2, marginTop: 2 }}>
                    triggers
                  </span>
                  {TRIGGER_CATALOG.map((tr) => {
                    const on = step?.triggers.includes(tr)
                    return (
                      <button
                        key={tr}
                        className="chip"
                        onClick={() => toggleTrigger(from, tr)}
                        style={{
                          cursor: 'pointer', border: 'none', fontSize: 10,
                          background: on ? 'var(--green-soft)' : 'var(--surface)',
                          color: on ? 'var(--green)' : 'var(--muted)',
                          opacity: on ? 1 : 0.6,
                        }}
                      >
                        {tr}
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>
          )
        })}
      </div>
      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
        SLA, DoA chain, and audit triggers are engine-enforced today; email and CSAT triggers
        take effect when the notification module goes live.
      </p>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
