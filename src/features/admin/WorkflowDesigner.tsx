import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { WorkflowCanvas } from './WorkflowCanvas'
import { WorkflowPreview } from './WorkflowPreview'
import { WorkflowProperties } from './WorkflowProperties'
import { WorkflowPublishDialog } from './WorkflowPublishDialog'
import { type Service } from '../../lib/types'
import { diffChips, diffGraphs, removedFromStates } from '../../lib/workflowDiff'
import { isApprovalPair } from '../../lib/workflowLayout'
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

/** "4 min ago" for the autosave note */
function ago(ts: string): string {
  const mins = Math.max(0, Math.round((Date.now() - new Date(ts).getTime()) / 60000))
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const h = Math.round(mins / 60)
  return `${h} h ago`
}

interface SvcRow extends Service { requires_approval: boolean }

interface PublishedInfo {
  version: number
  graph: WorkflowGraph
  publishedAt: string | null
  author: string | null
}

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
  const [published, setPublished] = useState<PublishedInfo | null>(null)
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null)
  const [hasDraftRow, setHasDraftRow] = useState(false)
  const [inFlight, setInFlight] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Status>('new')
  const [confirmPublish, setConfirmPublish] = useState(false)
  // suppress the autosave that would fire from setGraph during a load
  const skipSave = useRef(true)

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
    setError(null)
    setSelected('new')
    skipSave.current = true
    const { data } = await supabase
      .from('workflow_definitions')
      .select('version, graph, status, published_at, updated_at, author:profiles!workflow_definitions_created_by_fkey(display_name)')
      .eq('service_id', id)
      .in('status', ['published', 'draft'])
      .order('version', { ascending: false })
    type Row = {
      version: number; graph: Graph; status: string
      published_at: string | null; updated_at: string | null
      author: { display_name: string } | { display_name: string }[] | null
    }
    const rows = ((data ?? []) as unknown as Row[])
    const pub = rows.find((r) => r.status === 'published')
    const draft = rows.find((r) => r.status === 'draft')
    const authorName = (r?: Row) =>
      (Array.isArray(r?.author) ? r?.author[0]?.display_name : r?.author?.display_name) ?? null
    setPublished(pub ? { version: pub.version, graph: pub.graph, publishedAt: pub.published_at, author: authorName(pub) } : null)
    setHasDraftRow(Boolean(draft))
    setDraftSavedAt(draft?.updated_at ?? null)
    setGraph(draft?.graph ?? pub?.graph ?? defaultGraph())

    const { count } = await supabase
      .from('requests')
      .select('id', { count: 'exact', head: true })
      .eq('service_id', id)
      .not('status', 'in', '(closed,cancelled)')
    setInFlight(count ?? 0)
  }

  // diff against the published graph drives the version bar + edge styling
  const diff = useMemo(() => diffGraphs(published?.graph ?? null, graph), [published, graph])
  const chips = diffChips(diff)
  const draftVersion = (published?.version ?? 0) + 1
  const showDraft = hasDraftRow || !diff.empty

  // autosave the draft ~800ms after the last edit (WORKFL1 branch 4)
  useEffect(() => {
    if (skipSave.current) { skipSave.current = false; return }
    if (!serviceId) return
    if (diff.empty && !hasDraftRow) return // nothing worth persisting
    const t = setTimeout(async () => {
      const { data, error: e } = await supabase.rpc('save_workflow_draft', {
        p_service: serviceId, p_graph: graph,
      })
      if (e) { setError(e.message); return }
      setHasDraftRow(true)
      setDraftSavedAt(data as string)
    }, 800)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph])

  /** local editor back to the published graph (autosave then syncs the draft) */
  const revert = () => {
    if (!published) return
    setGraph(published.graph)
  }

  /** delete the draft row and return to the published graph */
  const discardDraft = async () => {
    setError(null)
    const { error: e } = await supabase
      .from('workflow_definitions')
      .delete()
      .eq('service_id', serviceId)
      .eq('status', 'draft')
    if (e) { setError(e.message); return }
    skipSave.current = true
    setHasDraftRow(false)
    setDraftSavedAt(null)
    setGraph(published?.graph ?? defaultGraph())
  }

  const addTransition = (from: Status, to: Status) => {
    setGraph((g) =>
      g.transitions.some((t) => t.from === from && t.to === to)
        ? g
        : { ...g, transitions: [...g.transitions, { from, to }] },
    )
  }

  const removeTransition = (from: Status, to: Status) => {
    // required-edge lock: the approval pair cannot be removed on services that
    // require approval (the server would reject the publish anyway)
    if (service?.requires_approval && isApprovalPair(from, to)) return
    setGraph((g) => ({
      ...g,
      transitions: g.transitions.filter((t) => !(t.from === from && t.to === to)),
    }))
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
  }

  const setStepLabel = (step: Status, text: string) => {
    setGraph((g) => ({
      ...g,
      steps: g.steps.map((s) =>
        s.id === step ? { ...s, label: text || undefined } : s
      ),
    }))
  }

  const doPublish = async () => {
    setError(null)
    const { error: e } = await supabase.rpc('publish_workflow', {
      p_service: serviceId,
      p_graph: graph,
    })
    setConfirmPublish(false)
    if (e) setError(e.message)
    else await loadWorkflow(serviceId) // reload: draft consumed, new published version
  }

  // Removing a published transition is the breaking case — surface the affected
  // in-flight requests in the shared impact dialog before committing. Purely
  // additive changes publish straight through.
  const publish = async () => {
    if (errors.length > 0) return
    if (diff.removedTransitions.length > 0) setConfirmPublish(true)
    else await doPublish()
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
        <span style={{ flex: 1 }} />
        {errors.length > 0 && (
          <span className="chip t-red">{errors.length} error{errors.length === 1 ? '' : 's'} block publish</span>
        )}
        <button
          className="btn primary"
          onClick={publish}
          disabled={diff.empty || errors.length > 0}
          title={errors.length > 0 ? 'Fix the validation errors before publishing' : diff.empty ? 'No changes against the published version' : undefined}
        >
          Publish v{draftVersion}
        </button>
      </div>

      {/* version / diff bar (WORKFL1 branch 4) */}
      <div className="wfd">
        <div className="verbar">
          <span className="ver">
            <span className="dot" style={{ background: published ? 'var(--green)' : 'var(--muted)' }} />
            <strong style={{ fontWeight: 600 }}>{published ? `v${published.version} published` : 'platform defaults'}</strong>
            {published?.publishedAt && (
              <span className="when">
                {new Date(published.publishedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                {published.author ? ` · ${published.author}` : ''}
              </span>
            )}
          </span>
          {showDraft && (
            <>
              <span className="ver-sep" role="presentation" />
              <span className="ver">
                <span className="dot" style={{ background: 'var(--amber)' }} />
                <strong style={{ fontWeight: 600 }}>v{draftVersion} draft</strong>
                <span className="when">
                  {draftSavedAt ? `edited ${ago(draftSavedAt)} · autosaved` : 'unsaved changes'}
                </span>
              </span>
              {chips.length > 0 && (
                <span className="diffs" aria-label={`Changes against v${published?.version ?? 0}`}>
                  {chips.map(([text, kind]) => (
                    <span key={text} className={`diff d-${kind}`}>{text}</span>
                  ))}
                </span>
              )}
            </>
          )}
          <span className="tool-spacer" />
          {showDraft && published && (
            <button className="btn ghost" onClick={revert}>Revert to v{published.version}</button>
          )}
          {hasDraftRow && (
            <button className="btn ghost" style={{ color: 'var(--red)' }} onClick={discardDraft}>Discard draft</button>
          )}
          <span className="note">
            {inFlight > 0
              ? `${inFlight} in-flight request${inFlight === 1 ? '' : 's'} keep${inFlight === 1 ? 's' : ''} running on ${published ? `v${published.version}` : 'the platform defaults'} until they close — publishing v${draftVersion} only affects requests raised from now on. `
              : `No requests are in flight on this service. `}
            Publish is blocked while the draft has errors.
          </span>
        </div>
      </div>

      <div className="wfd builder">
        <Palette selected={selected} graph={graph} onToggleTrigger={toggleTrigger} />
        <WorkflowCanvas
          graph={graph}
          requiresApproval={service?.requires_approval}
          errorSteps={errorSteps}
          issues={issues}
          diff={diff}
          draftVersion={draftVersion}
          selected={selected}
          onSelect={setSelected}
          onAddTransition={addTransition}
          onRemoveTransition={removeTransition}
          footer={
            <WorkflowPreview
              graph={graph}
              issues={issues}
              versionChip={
                showDraft
                  ? { text: `v${draftVersion} draft`, tone: 'amber' }
                  : published
                    ? { text: `v${published.version} published`, tone: 'green' }
                    : { text: 'platform defaults', tone: 'muted' }
              }
            />
          }
        />
        <WorkflowProperties
          graph={graph}
          step={selected}
          issues={issues}
          requiresApproval={service?.requires_approval}
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

      {confirmPublish && (
        <WorkflowPublishDialog
          serviceId={serviceId}
          fromVersion={published?.version ?? null}
          toVersion={draftVersion}
          removed={diff.removedTransitions}
          fromStates={removedFromStates(diff)}
          onCancel={() => setConfirmPublish(false)}
          onConfirm={doPublish}
        />
      )}
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
          Click a trigger to toggle it on the selected step, or drag from a step's edge
          handle to draw a transition.
        </p>
      </div>
    </aside>
  )
}
