import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { WorkflowCanvas } from './WorkflowCanvas'
import { WorkflowProperties } from './WorkflowProperties'
import { type Service } from '../../lib/types'
import { TRIGGER_CATALOG, triggerAllowedOn } from '../../lib/workflowTriggers'
import {
  analyzeWorkflow,
  type WorkflowGraph,
  type WorkflowStatus,
  type WorkflowTransition,
} from '../../lib/workflowValidate'
import './workflowDesigner.css'

type Status = WorkflowStatus

const STATUSES: Status[] = [
  'new', 'triaged', 'in_progress', 'pending_approval', 'pending_requester',
  'escalated', 'resolved', 'closed', 'cancelled',
]

const STATUS_DOT: Record<Status, string> = {
  new: 'var(--it)', triaged: 'var(--admin)', in_progress: 'var(--amber)',
  pending_approval: 'var(--accent)', pending_requester: 'var(--amber)',
  escalated: 'var(--red)', resolved: 'var(--green)', closed: 'var(--muted)',
  cancelled: 'var(--muted)',
}

type Graph = WorkflowGraph

const DEFAULT_TRANSITIONS: WorkflowTransition[] = [
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

const label = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')

interface SvcRow extends Service { requires_approval: boolean }

/**
 * Workflow designer — three-pane builder (palette · canvas · properties) per
 * prototype/workflow-designer-reference.html. The graph is edited spatially:
 * click a step on the canvas to edit its transitions, triggers and requester
 * wording in the properties pane. Validation runs live on every change and
 * gates Publish.
 */
export function WorkflowDesigner() {
  const { hasRole } = useAuth()
  const [services, setServices] = useState<SvcRow[]>([])
  const [serviceId, setServiceId] = useState('')
  const [graph, setGraph] = useState<Graph>(defaultGraph())
  const [version, setVersion] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Status>('new')

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
  const errorSteps = useMemo(
    () => new Set(errors.map((e) => e.nodeId).filter(Boolean) as WorkflowStatus[]),
    [errors],
  )

  const loadWorkflow = async (id: string) => {
    setServiceId(id)
    setDirty(false)
    setError(null)
    setSelected('new')
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

  const addTransition = (from: Status, to: Status) => {
    setGraph((g) =>
      g.transitions.some((t) => t.from === from && t.to === to)
        ? g
        : { ...g, transitions: [...g.transitions, { from, to }] },
    )
    setDirty(true)
  }

  const removeTransition = (from: Status, to: Status) => {
    setGraph((g) => ({
      ...g,
      transitions: g.transitions.filter((t) => !(t.from === from && t.to === to)),
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

  const setStepLabel = (step: Status, text: string) => {
    setGraph((g) => ({
      ...g,
      steps: g.steps.map((s) =>
        s.id === step ? { ...s, label: text || undefined } : s
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

  return (
    <>
      <h2 className="page-head">Workflow designer</h2>
      <p className="page-sub">
        The published workflow is what the database enforces — a transition removed here is
        rejected server-side, buttons or not.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14, flexWrap: 'wrap' }}>
        <select className="input" style={{ maxWidth: 340 }} value={serviceId} onChange={(e) => loadWorkflow(e.target.value)} aria-label="Service">
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
          <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber-ink)' }}>
            unpublished changes
          </span>
        )}
        <span style={{ flex: 1 }} />
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

      <div className="wfd builder">
        <Palette selected={selected} graph={graph} onToggleTrigger={toggleTrigger} />
        <WorkflowCanvas
          graph={graph}
          requiresApproval={service?.requires_approval}
          errorSteps={errorSteps}
          issues={issues}
          selected={selected}
          onSelect={setSelected}
        />
        <WorkflowProperties
          graph={graph}
          step={selected}
          issues={issues}
          onAddTransition={addTransition}
          onRemoveTransition={removeTransition}
          onToggleTrigger={toggleTrigger}
          onSetLabel={setStepLabel}
        />
      </div>

      <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
        SLA, DoA chain, and audit triggers are engine-enforced today; email and CSAT triggers
        take effect when the notification module goes live.
      </p>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}

/** Statuses + triggers palette. Statuses are the fixed platform set (all on
 *  canvas); clicking a trigger toggles it on the selected step. */
function Palette({
  selected, graph, onToggleTrigger,
}: {
  selected: Status
  graph: Graph
  onToggleTrigger: (step: Status, trigger: string) => void
}) {
  const stepTriggers = graph.steps.find((s) => s.id === selected)?.triggers ?? []
  return (
    <aside className="pane" aria-label="Steps and triggers palette">
      <div className="pane-head">Palette</div>
      <div className="palette">
        <div className="pal-group">Statuses</div>
        {STATUSES.map((s) => (
          <button className="pal-item used" key={s} tabIndex={-1}>
            <span className="pal-dot" style={{ background: STATUS_DOT[s] }} />
            {label(s)}
            <span className="pal-on">on canvas</span>
          </button>
        ))}
        <div className="pal-group">Triggers</div>
        {TRIGGER_CATALOG.map((t) => {
          const on = stepTriggers.includes(t.key)
          const allowed = triggerAllowedOn(t.key, selected)
          return (
            <button
              className={`pal-item${on ? ' used' : ''}`}
              key={t.key}
              disabled={!allowed}
              title={allowed ? `Toggle on ${label(selected)}` : t.sub}
              onClick={() => allowed && onToggleTrigger(selected, t.key)}
            >
              <span className="pal-ico">{t.ico}</span>
              {t.label}
              {on && <span className="pal-on">on {label(selected)}</span>}
            </button>
          )
        })}
        <p className="hint" style={{ margin: '8px 6px 2px' }}>
          Click a trigger to toggle it on the selected step. Transitions are edited in the
          step's properties.
        </p>
      </div>
    </aside>
  )
}
