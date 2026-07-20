import { useState } from 'react'
import { TRIGGER_CATALOG, triggerAllowedOn } from '../../lib/workflowTriggers'
import type { WorkflowGraph, WorkflowIssue, WorkflowStatus } from '../../lib/workflowValidate'
import './workflowDesigner.css'

const STATUS_DOT: Record<WorkflowStatus, string> = {
  new: 'var(--it)', triaged: 'var(--admin)', in_progress: 'var(--amber)',
  pending_approval: 'var(--accent)', pending_requester: 'var(--amber)',
  escalated: 'var(--red)', resolved: 'var(--green)', closed: 'var(--muted)',
  cancelled: 'var(--muted)',
}

const HAPPY: WorkflowStatus[] = ['new', 'triaged', 'in_progress', 'resolved', 'closed']

const label = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')

function roleOf(id: WorkflowStatus): string {
  if (HAPPY.includes(id)) return 'happy path'
  if (id === 'cancelled') return 'terminal'
  return 'side path'
}

export interface PropertiesProps {
  graph: WorkflowGraph
  step: WorkflowStatus
  issues: WorkflowIssue[]
  onAddTransition: (from: WorkflowStatus, to: WorkflowStatus) => void
  onRemoveTransition: (from: WorkflowStatus, to: WorkflowStatus) => void
  onToggleTrigger: (step: WorkflowStatus, trigger: string) => void
  onSetLabel: (step: WorkflowStatus, label: string) => void
}

/**
 * Step properties pane (WORKFL1 branch 3). Trigger editing lives here as
 * per-step toggles off the typed catalog; transitions are listed and edited
 * per step; the requester-visible wording writes steps[].label (additive to
 * the JSONB, ignored by the engine).
 */
export function WorkflowProperties({
  graph, step, issues, onAddTransition, onRemoveTransition, onToggleTrigger, onSetLabel,
}: PropertiesProps) {
  const [adding, setAdding] = useState(false)
  const def = graph.steps.find((s) => s.id === step)
  const incoming = graph.transitions.filter((t) => t.to === step)
  const outgoing = graph.transitions.filter((t) => t.from === step)
  const stepIssues = issues.filter((i) => i.nodeId === step)
  const deadEnd = stepIssues.find((i) => i.message.includes('dead end'))
  const terminal = step === 'closed' || step === 'cancelled'
  const role = roleOf(step)

  const addTargets = graph.steps
    .map((s) => s.id)
    .filter((id) => id !== step && !outgoing.some((t) => t.to === id))

  return (
    <aside className="pane wfd" aria-label="Step properties">
      <div className="pane-head"><span>Properties</span><span className="chip t-muted mono">step</span></div>
      <div className="props">
        <div className="p-head">
          <span className="ndot" style={{ background: STATUS_DOT[step], width: 8, height: 8, borderRadius: '50%' }} />
          <span className="p-name">{label(step)}</span>
        </div>
        <div className="p-key">{step} · {role}</div>

        {deadEnd && (
          <div className="callout err">
            <span className="ct">Dead end</span>
            This step has no outgoing transition, so a request that enters it can never leave.
            Publishing is blocked until it has a way out.
            <button className="btn" onClick={() => onAddTransition(step, 'in_progress')}>
              Restore → In progress
            </button>
          </div>
        )}
        {stepIssues.filter((i) => i !== deadEnd).map((i, k) => (
          <div className="callout err" key={k} style={i.severity === 'warning' ? { background: 'var(--amber-soft)', color: 'var(--amber-ink)', border: '1px solid #EBD9B4' } : undefined}>
            {i.message}
          </div>
        ))}

        <div className="prop-sec">Role in the flow</div>
        <div className="seg full" role="group" aria-label="Role in the flow">
          <button className={role === 'happy path' ? 'on' : ''} disabled title="Lane assignment is fixed for platform statuses">Happy path</button>
          <button className={role !== 'happy path' ? 'on' : ''} disabled title="Lane assignment is fixed for platform statuses">Side path</button>
        </div>
        <p className="hint">
          Side paths are drawn de-emphasised on the canvas and appear as a banner, not a
          lifecycle step, for the requester.
        </p>

        <div className="prop-sec">Transitions</div>
        <div className="prop-row">
          <span className="prop-lbl">Incoming</span>
          {incoming.map((t) => (
            <div className="tr" key={t.from}>
              <span className="arrow">→</span>{label(t.from)}
              <button className="x" aria-label={`Remove transition from ${label(t.from)}`} onClick={() => onRemoveTransition(t.from, step)}>×</button>
            </div>
          ))}
          {incoming.length === 0 && (
            <div className="tr" style={{ color: 'var(--muted)', fontStyle: 'italic' }}>
              {step === 'new' ? 'entry point — requests start here' : 'none'}
            </div>
          )}
        </div>
        <div className="prop-row">
          <span className="prop-lbl">Outgoing</span>
          {outgoing.map((t) => (
            <div className="tr" key={t.to}>
              <span className="arrow">→</span>{label(t.to)}
              <button className="x" aria-label={`Remove transition to ${label(t.to)}`} onClick={() => onRemoveTransition(step, t.to)}>×</button>
            </div>
          ))}
          {outgoing.length === 0 && (
            <div className={`tr${terminal ? '' : ' empty'}`} style={terminal ? { color: 'var(--muted)', fontStyle: 'italic' } : undefined}>
              {terminal ? 'terminal — requests stop here' : 'none — dead end'}
            </div>
          )}
          {adding ? (
            <select
              className="input"
              autoFocus
              value=""
              aria-label="Add outgoing transition"
              onChange={(e) => {
                if (e.target.value) onAddTransition(step, e.target.value as WorkflowStatus)
                setAdding(false)
              }}
              onBlur={() => setAdding(false)}
            >
              <option value="">Choose a target step…</option>
              {addTargets.map((id) => <option key={id} value={id}>{label(id)}</option>)}
            </select>
          ) : (
            <button
              className="btn"
              style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed', marginTop: 5 }}
              onClick={() => setAdding(true)}
              disabled={addTargets.length === 0}
            >
              + Add outgoing transition
            </button>
          )}
        </div>

        <div className="prop-sec">Triggers <span className="chip t-muted mono" style={{ fontSize: 9 }}>on entry</span></div>
        {TRIGGER_CATALOG.map((t) => {
          const on = def?.triggers.includes(t.key) ?? false
          const allowed = triggerAllowedOn(t.key, step)
          return (
            <div className="toggle-row" key={t.key}>
              <span style={allowed ? undefined : { color: 'var(--muted)' }}>
                {t.label}
                <span className="sub">{t.sub}</span>
              </span>
              <button
                className={`toggle${on ? ' on' : ''}`}
                role="switch"
                aria-checked={on}
                aria-label={t.label}
                disabled={!allowed}
                title={allowed ? undefined : t.sub}
                onClick={() => allowed && onToggleTrigger(step, t.key)}
              />
            </div>
          )
        })}

        <div className="prop-sec">Requester wording</div>
        <div className="prop-row">
          <input
            className="input"
            value={def?.label ?? ''}
            placeholder={label(step)}
            aria-label="Requester-visible label"
            onChange={(e) => onSetLabel(step, e.target.value)}
          />
          <p className="hint">Shown in the requester portal instead of the raw status key.</p>
        </div>
      </div>
    </aside>
  )
}
