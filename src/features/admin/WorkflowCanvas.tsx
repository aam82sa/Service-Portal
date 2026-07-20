import { useMemo } from 'react'
import { layoutWorkflow, type EdgeKind } from '../../lib/workflowLayout'
import type { WorkflowGraph, WorkflowStatus } from '../../lib/workflowValidate'
import './workflowDesigner.css'

const STATUS_DOT: Record<WorkflowStatus, string> = {
  new: 'var(--it)', triaged: 'var(--admin)', in_progress: 'var(--amber)',
  pending_approval: 'var(--accent)', pending_requester: 'var(--amber)',
  escalated: 'var(--red)', resolved: 'var(--green)', closed: 'var(--muted)',
  cancelled: 'var(--muted)',
}

const label = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')

/** trigger key → compact node badge (icon + short label), matching the reference */
const TRIGGER_BADGE: Record<string, { t: string; cls?: 'act' | 'pos' }> = {
  'ack email': { t: '@ ack email' },
  'start SLA': { t: '▶ SLA', cls: 'pos' },
  'pause SLA': { t: '‖ pause SLA' },
  'auto-assign': { t: 'As assign' },
  'DoA chain': { t: 'DoA chain', cls: 'act' },
  'notify team lead': { t: '@ notify lead' },
  'CSAT survey': { t: '% CSAT' },
}

const EDGE_STROKE: Record<EdgeKind, { color: string; width: number; dash?: string; marker: string }> = {
  happy: { color: '#3B4763', width: 2, marker: 'a-ink' },
  approval: { color: 'var(--accent)', width: 2, marker: 'a-acc' },
  side: { color: '#AEB6C6', width: 1.5, dash: '5 4', marker: 'a-mut' },
}

function keySuffix(id: WorkflowStatus): string {
  if (id === 'new') return ' · entry'
  if (id === 'closed' || id === 'cancelled') return ' · terminal'
  return ''
}

export interface CanvasProps {
  graph: WorkflowGraph
  requiresApproval?: boolean
  /** step ids with a live error → red node border + ! flag */
  errorSteps?: Set<WorkflowStatus>
  selected?: WorkflowStatus | null
  onSelect?: (id: WorkflowStatus) => void
}

/**
 * Read-only status-node canvas (WORKFL1 branch 1). Happy path on the weighted
 * top lane, side paths dashed and muted below, approval loop in accent when the
 * service requires it. Live-validation markers and editing arrive in branches
 * 2–5; this renders the graph faithfully to the reference.
 */
export function WorkflowCanvas({ graph, requiresApproval, errorSteps, selected, onSelect }: CanvasProps) {
  const layout = useMemo(() => layoutWorkflow(graph, { requiresApproval }), [graph, requiresApproval])
  const triggersOf = (id: WorkflowStatus) => graph.steps.find((s) => s.id === id)?.triggers ?? []

  return (
    <section className="pane wfd" aria-label="Workflow canvas">
      <div className="pane-head">
        <span>Canvas — happy path weighted, side paths muted</span>
        <span className="chip t-muted mono">{layout.nodes.length} steps · {layout.edges.length} transitions</span>
      </div>

      <div className="canvas-wrap">
        <div className="flow" style={{ width: layout.width, height: layout.height }}>
          <svg viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} aria-hidden="true">
            <defs>
              {(['a-ink', 'a-mut', 'a-acc', 'a-grn', 'a-red'] as const).map((id) => {
                const fill = { 'a-ink': '#3B4763', 'a-mut': '#AEB6C6', 'a-acc': '#D97757', 'a-grn': '#2E9E6B', 'a-red': '#D64545' }[id]
                return (
                  <marker key={id} id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                    <path d="M0,1 L9,5 L0,9 z" fill={fill} />
                  </marker>
                )
              })}
            </defs>
            {layout.edges.map((e, i) => {
              const s = EDGE_STROKE[e.kind]
              return (
                <path key={`${e.from}-${e.to}-${i}`} d={e.d} stroke={s.color} strokeWidth={s.width}
                  strokeDasharray={s.dash} fill="none" markerEnd={`url(#${s.marker})`} />
              )
            })}
          </svg>

          <span className="lane-lbl" style={{ insetInlineStart: 0, top: 22 }}>Happy path</span>
          <span className="lane-lbl" style={{ insetInlineStart: 0, top: 178 }}>Side paths</span>

          {layout.nodes.map((n) => {
            const trigs = triggersOf(n.id)
            const shown = trigs.slice(0, 2)
            const extra = trigs.length - shown.length
            const isErr = errorSteps?.has(n.id)
            const cls = ['node']
            if (n.lane !== 'happy') cls.push('side')
            if (n.terminal) cls.push('terminal')
            if (selected === n.id) cls.push('sel')
            if (isErr) cls.push('err')
            const showLock = n.id === 'pending_approval' && requiresApproval
            return (
              <button
                key={n.id}
                className={cls.join(' ')}
                style={{ insetInlineStart: n.x, top: n.y }}
                onClick={() => onSelect?.(n.id)}
                aria-current={selected === n.id ? 'true' : undefined}
              >
                {isErr && <span className="n-flag e">!</span>}
                <span className="n-top">
                  <span className="ndot" style={{ background: STATUS_DOT[n.id] }} />
                  <span className="nname">{label(n.id)}</span>
                  {showLock && <span className="n-lock">req</span>}
                </span>
                <span className="nkey mono">{n.id}{keySuffix(n.id)}</span>
                {trigs.length > 0 && (
                  <span className="badges">
                    {shown.map((t) => {
                      const b = TRIGGER_BADGE[t] ?? { t }
                      return <span key={t} className={`tb${b.cls ? ' ' + b.cls : ''}`}>{b.t}</span>
                    })}
                    {extra > 0 && <span className="tb more">+{extra}</span>}
                  </span>
                )}
                {isErr && <span className="n-note">Dead end — no way out</span>}
              </button>
            )
          })}
        </div>
      </div>

      <div className="legend">
        <span className="lg"><i style={{ borderColor: '#3B4763' }} />Happy path</span>
        <span className="lg"><i style={{ borderColor: '#AEB6C6', borderTopStyle: 'dashed' }} />Side path</span>
        <span className="lg"><i style={{ borderColor: 'var(--accent)' }} />Required by service settings</span>
        <span className="tool-spacer" />
        <span>Server enforces the published graph — a transition removed here is rejected on save, buttons or not.</span>
      </div>
    </section>
  )
}
