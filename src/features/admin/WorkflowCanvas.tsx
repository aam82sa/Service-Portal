import { useEffect, useMemo, useRef, useState } from 'react'
import { isApprovalPair, layoutWorkflow, transitionKey, NODE_H, NODE_W, type EdgeKind } from '../../lib/workflowLayout'
import { triggerBadge } from '../../lib/workflowTriggers'
import type { GraphDiff } from '../../lib/workflowDiff'
import type { WorkflowGraph, WorkflowIssue, WorkflowStatus } from '../../lib/workflowValidate'
import './workflowDesigner.css'

const STATUS_DOT: Record<WorkflowStatus, string> = {
  new: 'var(--it)', triaged: 'var(--admin)', in_progress: 'var(--amber)',
  pending_approval: 'var(--accent)', pending_requester: 'var(--amber)',
  escalated: 'var(--red)', resolved: 'var(--green)', closed: 'var(--muted)',
  cancelled: 'var(--muted)',
}

const label = (s: string) => (s.charAt(0).toUpperCase() + s.slice(1)).replace(/_/g, ' ')

const EDGE_STROKE: Record<EdgeKind, { color: string; width: number; dash?: string; marker: string; opacity?: number }> = {
  happy: { color: '#3B4763', width: 2, marker: 'a-ink' },
  approval: { color: 'var(--accent)', width: 2, marker: 'a-acc' },
  side: { color: '#AEB6C6', width: 1.5, dash: '5 4', marker: 'a-mut' },
  added: { color: '#2E9E6B', width: 2, marker: 'a-grn' },
  removed: { color: '#D64545', width: 1.5, dash: '3 5', marker: 'a-red', opacity: 0.75 },
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
  /** live validation issues — rendered as the strip above the canvas */
  issues?: WorkflowIssue[]
  /** diff against the published graph — added edges green, removed as ghosts */
  diff?: GraphDiff
  /** draft version number, for the "removed in vN" tag */
  draftVersion?: number
  selected?: WorkflowStatus | null
  onSelect?: (id: WorkflowStatus) => void
  /** drag-from-handle target (WORKFL1 branch 5) — canvas is read-only without it */
  onAddTransition?: (from: WorkflowStatus, to: WorkflowStatus) => void
  /** click-edge-to-delete — the approval pair is locked when required */
  onRemoveTransition?: (from: WorkflowStatus, to: WorkflowStatus) => void
}

interface DragState {
  from: WorkflowStatus
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Status-node canvas: happy path on the weighted top lane, side paths dashed
 * and muted below, approval loop in accent when the service requires it.
 * Editing: drag from a node's edge handle to draw a transition, click an edge
 * to delete it (the required approval pair is locked), click a node to edit it
 * in the properties pane. Live validation anchors errors to nodes.
 */
export function WorkflowCanvas({
  graph, requiresApproval, errorSteps, issues, diff, draftVersion, selected, onSelect,
  onAddTransition, onRemoveTransition,
}: CanvasProps) {
  const flowRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<DragState | null>(null)

  // while dragging: follow the pointer; on release, drop onto a node
  useEffect(() => {
    if (!drag) return
    const move = (e: PointerEvent) => {
      const r = flowRef.current?.getBoundingClientRect()
      if (!r) return
      setDrag((d) => (d ? { ...d, x2: e.clientX - r.left, y2: e.clientY - r.top } : d))
    }
    const up = (e: PointerEvent) => {
      const target = (document.elementFromPoint(e.clientX, e.clientY) as Element | null)?.closest('[data-node]')
      const to = target?.getAttribute('data-node') as WorkflowStatus | null
      if (to && to !== drag.from && !graph.transitions.some((t) => t.from === drag.from && t.to === to)) {
        onAddTransition?.(drag.from, to)
      }
      setDrag(null)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [drag, graph, onAddTransition])

  const startDrag = (from: WorkflowStatus, x: number, y: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDrag({ from, x1: x, y1: y, x2: x, y2: y })
  }
  const layout = useMemo(
    () => layoutWorkflow(graph, {
      requiresApproval,
      added: diff ? new Set(diff.addedTransitions.map(transitionKey)) : undefined,
      ghosts: diff?.removedTransitions,
    }),
    [graph, requiresApproval, diff],
  )
  const triggersOf = (id: WorkflowStatus) => graph.steps.find((s) => s.id === id)?.triggers ?? []
  const errors = (issues ?? []).filter((i) => i.severity === 'error')
  const warnings = (issues ?? []).filter((i) => i.severity === 'warning')
  const closedReachable = issues && !errors.some((e) => e.message.startsWith('Closed is not reachable'))

  return (
    <section className="pane wfd" aria-label="Workflow canvas">
      <div className="pane-head">
        <span>{onAddTransition ? 'Canvas — drag to connect · click a step to edit' : 'Canvas — click a step to edit'}</span>
        <span className="chip t-muted mono">
          {layout.nodes.length} steps · {graph.transitions.length} transitions
        </span>
      </div>

      {issues && (
        <div className="valbar" role="status" aria-label="Live validation">
          <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '.4px', textTransform: 'uppercase', color: 'var(--muted)', marginInlineEnd: 2 }}>
            Validation
          </span>
          {errors.map((e, i) => (
            <button className="vitem err" key={`e${i}`} onClick={() => e.nodeId && onSelect?.(e.nodeId)}>
              <span className="vmark e">!</span>{e.message}
            </button>
          ))}
          {warnings.map((w, i) => (
            <button className="vitem warn" key={`w${i}`} onClick={() => w.nodeId && onSelect?.(w.nodeId)}>
              <span className="vmark w">•</span>{w.message}
            </button>
          ))}
          {errors.length === 0 && warnings.length === 0 && (
            <span className="vitem" style={{ color: 'var(--green)' }}>All guardrails satisfied.</span>
          )}
          <span className="tool-spacer" />
          {closedReachable && <span className="chip t-green">Closed reachable from New</span>}
        </div>
      )}

      <div className="canvas-wrap">
        <div className="flow" ref={flowRef} style={{ width: layout.width, height: layout.height }}>
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
                  strokeDasharray={s.dash} fill="none" markerEnd={`url(#${s.marker})`} opacity={s.opacity} />
              )
            })}
            {/* click-to-delete hit areas over the real (non-ghost) edges */}
            {onRemoveTransition && layout.edges.filter((e) => e.kind !== 'removed').map((e, i) => {
              const locked = Boolean(requiresApproval) && isApprovalPair(e.from, e.to)
              return (
                <path
                  key={`hit-${e.from}-${e.to}-${i}`}
                  d={e.d}
                  stroke="transparent"
                  strokeWidth={12}
                  fill="none"
                  pointerEvents="stroke"
                  style={{ cursor: locked ? 'not-allowed' : 'pointer' }}
                  onClick={() => { if (!locked) onRemoveTransition(e.from, e.to) }}
                >
                  <title>
                    {locked
                      ? 'Required — this service needs approval; the pair cannot be removed'
                      : `Delete transition ${label(e.from)} → ${label(e.to)}`}
                  </title>
                </path>
              )
            })}
            {/* temp line while drawing a transition */}
            {drag && (
              <line x1={drag.x1} y1={drag.y1} x2={drag.x2} y2={drag.y2}
                stroke="var(--accent)" strokeWidth={2} strokeDasharray="6 4" markerEnd="url(#a-acc)" />
            )}
          </svg>

          {layout.edges.filter((e) => e.kind === 'added' || e.kind === 'removed').map((e, i) => (
            <span
              key={`tag-${e.from}-${e.to}-${i}`}
              className={`etag ${e.kind === 'added' ? 'add' : 'del'}`}
              style={{ insetInlineStart: e.mid.x + 6, top: e.mid.y - 8 }}
            >
              {e.kind === 'added' ? '+ added' : `removed in v${draftVersion ?? '?'}`}
            </span>
          ))}
          {requiresApproval && (() => {
            const appr = layout.edges.find((e) => e.from === 'in_progress' && e.to === 'pending_approval')
            return appr ? (
              <span className="etag req" style={{ insetInlineStart: appr.mid.x - 60, top: appr.mid.y - 8 }}>
                required — service needs approval
              </span>
            ) : null
          })()}

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
              <span key={n.id}>
                <button
                  data-node={n.id}
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
                        const b = triggerBadge(t)
                        return <span key={t} className={`tb${b.cls ? ' ' + b.cls : ''}`}>{b.text}</span>
                      })}
                      {extra > 0 && <span className="tb more">+{extra}</span>}
                    </span>
                  )}
                  {isErr && <span className="n-note">Dead end — no way out</span>}
                </button>
                {onAddTransition && (
                  <span
                    className="nhandle"
                    role="button"
                    aria-label={`Draw a transition from ${label(n.id)}`}
                    title={`Drag to draw a transition from ${label(n.id)}`}
                    style={{ insetInlineStart: n.x + NODE_W - 7, top: n.y + NODE_H / 2 - 7 }}
                    onPointerDown={startDrag(n.id, n.x + NODE_W, n.y + NODE_H / 2)}
                  />
                )}
              </span>
            )
          })}
        </div>
      </div>

      <div className="legend">
        <span className="lg"><i style={{ borderColor: '#3B4763' }} />Happy path</span>
        <span className="lg"><i style={{ borderColor: '#AEB6C6', borderTopStyle: 'dashed' }} />Side path</span>
        <span className="lg"><i style={{ borderColor: 'var(--accent)' }} />Required by service settings</span>
        {diff && !diff.empty && (
          <>
            <span className="lg"><i style={{ borderColor: 'var(--green)' }} />Added in draft</span>
            <span className="lg"><i style={{ borderColor: 'var(--red)', borderTopStyle: 'dashed' }} />Removed in draft</span>
          </>
        )}
        <span className="tool-spacer" />
        <span>Server enforces the published graph — a transition removed here is rejected on save, buttons or not.</span>
      </div>
    </section>
  )
}
