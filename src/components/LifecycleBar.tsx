import type { CSSProperties } from 'react'
import { Icon, type IconName } from './icons'

export interface LifecycleStep {
  key: string
  label: string
  icon?: IconName
  completedAt?: string
  actor?: string
}

export interface LifecycleBarProps {
  steps: LifecycleStep[]
  currentIndex: number
  state?: 'normal' | 'pending_requester' | 'escalated' | 'rejected'
  stateNote?: string
  slaDue?: string
  slaStart?: string
  timeInStep?: string
  compact?: boolean
  header?: { ref: string; title: string; subtitle: string }
  /** department rail color pair; defaults to the IT blue */
  color?: string
  soft?: string
}

const STATE_BADGE: Record<string, { label: string; bg: string; fg: string }> = {
  pending_requester: { label: 'Waiting on requester', bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  escalated: { label: 'Escalated', bg: 'var(--red-soft)', fg: 'var(--red)' },
  rejected: { label: 'Rejected', bg: 'var(--red-soft)', fg: 'var(--red)' },
}

const shortDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short' })

function slaChip(due: string, start?: string) {
  const left = new Date(due).getTime() - Date.now()
  const total = start ? new Date(due).getTime() - new Date(start).getTime() : null
  const overdue = left < 0
  const tight = !overdue && total !== null && total > 0 && left / total < 0.25
  const abs = Math.abs(left)
  const h = Math.floor(abs / 3600000)
  const span = h >= 48 ? `${Math.floor(h / 24)}d` : h >= 1 ? `${h}h` : `${Math.max(1, Math.floor(abs / 60000))}m`
  return {
    text: overdue ? `SLA overdue ${span}` : `SLA due in ${span}`,
    bg: overdue ? 'var(--red-soft)' : tight ? 'var(--amber-soft)' : 'var(--surface)',
    fg: overdue ? 'var(--red)' : tight ? 'var(--amber)' : 'var(--muted)',
  }
}

type Node =
  | { kind: 'step'; step: LifecycleStep; i: number }
  | { kind: 'gap'; count: number; i: number }

/** Long workflows collapse runs of off-focus steps into a "···" node; the
 *  first, last and current ± 1 steps always stay visible. */
function toNodes(steps: LifecycleStep[], current: number): Node[] {
  if (steps.length <= 7) return steps.map((step, i) => ({ kind: 'step', step, i }))
  const keep = new Set([0, steps.length - 1, current - 1, current, current + 1])
  const out: Node[] = []
  let gap = 0
  steps.forEach((step, i) => {
    if (keep.has(i)) {
      if (gap > 0) { out.push({ kind: 'gap', count: gap, i: i - 1 }); gap = 0 }
      out.push({ kind: 'step', step, i })
    } else {
      gap += 1
    }
  })
  if (gap > 0) out.push({ kind: 'gap', count: gap, i: steps.length - 2 })
  return out.sort((a, b) => a.i - b.i)
}

export function LifecycleBar({
  steps, currentIndex, state = 'normal', stateNote, slaDue, slaStart, timeInStep,
  compact = false, header, color = 'var(--it)', soft = 'var(--it-soft)',
}: LifecycleBarProps) {
  if (steps.length === 0) return null
  const nodes = toNodes(steps, currentIndex)
  const n = nodes.length
  const pos = (idx: number) => (n === 1 ? 0 : (idx / (n - 1)) * 100)
  const currentNodeIdx = nodes.findIndex((d) => d.kind === 'step' && d.i === currentIndex)
  const fillPct = currentNodeIdx <= 0 ? 0 : pos(currentNodeIdx)
  const branch = state !== 'normal'
  const currColor = state === 'escalated' || state === 'rejected' ? 'var(--red)' : 'var(--amber)'
  const currSoft = state === 'escalated' || state === 'rejected' ? 'var(--red-soft)' : 'var(--amber-soft)'
  const badge = STATE_BADGE[state]
  const remaining = steps.slice(currentIndex + 1)
  const sla = slaDue ? slaChip(slaDue, slaStart) : null

  const nodeStyle = (left: number): CSSProperties => ({
    position: 'absolute', top: '50%', insetInlineStart: `${left}%`,
    transform: 'translate(-50%, -50%)',
  })

  return (
    <div className="lb">
      {header && !compact && (
        <div className="lb-head">
          <span className="tile-code" style={{ background: soft, color }}>{header.ref}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="lb-title">{header.title}</div>
            <div className="lb-sub">{header.subtitle}</div>
          </div>
          {sla && <span className="chip mono" style={{ background: sla.bg, color: sla.fg }}>{sla.text}</span>}
        </div>
      )}
      {!header && sla && !compact && (
        <div className="lb-head" style={{ justifyContent: 'flex-end' }}>
          <span className="chip mono" style={{ background: sla.bg, color: sla.fg }}>{sla.text}</span>
        </div>
      )}

      <div className={`lb-bar${compact ? ' lb-compact' : ''}`}>
        <div className="lb-track" />
        <div className="lb-fill" style={{ width: `${fillPct}%`, background: color }} />
        {nodes.map((d, idx) => {
          const left = pos(idx)
          if (d.kind === 'gap') {
            return (
              <div key={`gap-${d.i}`} className="lb-node lb-node-gap" style={nodeStyle(left)} title={`${d.count} steps`}>
                ···
              </div>
            )
          }
          const done = d.i < currentIndex
          const curr = d.i === currentIndex
          if (curr) {
            return (
              <div
                key={d.step.key} className="lb-node lb-node-curr" style={{
                  ...nodeStyle(left), background: currSoft, borderColor: currColor,
                  color: currColor, boxShadow: `0 0 0 4px ${currSoft}`,
                }}
                title={d.step.label}
              >
                {d.step.icon ? <Icon name={d.step.icon} size={compact ? 11 : 15} /> : <span className="lb-dot" style={{ background: currColor }} />}
              </div>
            )
          }
          if (done) {
            return (
              <div
                key={d.step.key} className="lb-node lb-node-done" style={{ ...nodeStyle(left), background: color }}
                title={d.step.actor ? `${d.step.label} — ${d.step.actor}` : d.step.label}
              >
                <Icon name="check" size={compact ? 10 : 13} />
              </div>
            )
          }
          return (
            <div key={d.step.key} className="lb-node lb-node-next" style={nodeStyle(left)} title={d.step.label}>
              {d.step.icon ? <Icon name={d.step.icon} size={compact ? 10 : 13} /> : <span className="lb-dot" style={{ background: 'var(--line)' }} />}
            </div>
          )
        })}
      </div>

      {!compact && (
        <div className="lb-labels">
          {nodes.map((d, idx) => {
            const left = pos(idx)
            const align: CSSProperties =
              idx === 0 ? { insetInlineStart: 0, textAlign: 'start' }
                : idx === n - 1 ? { insetInlineEnd: 0, textAlign: 'end' }
                  : { insetInlineStart: `${left}%`, transform: 'translateX(-50%)', textAlign: 'center' }
            if (d.kind === 'gap') {
              return <div key={`gl-${d.i}`} className="lb-label" style={align}><span className="lb-when">{d.count} steps</span></div>
            }
            const done = d.i < currentIndex
            const curr = d.i === currentIndex
            return (
              <div key={d.step.key} className="lb-label" style={align}>
                <div style={{ fontWeight: curr ? 600 : 500, color: curr ? currColor : done ? 'var(--ink)' : 'var(--muted)', fontSize: curr ? 11 : 10.5 }}>
                  {d.step.label}
                </div>
                {done && d.step.completedAt && <span className="lb-when">{shortDate(d.step.completedAt)}</span>}
                {curr && <span className="lb-when" style={{ color: currColor }}>now{timeInStep ? ` · ${timeInStep}` : ''}</span>}
              </div>
            )
          })}
        </div>
      )}

      {branch && badge && !compact && (
        <div className="lb-state">
          <span className="chip" style={{ background: badge.bg, color: badge.fg, fontWeight: 600 }}>{badge.label}</span>
          {stateNote && <span className="lb-sub">{stateNote}</span>}
        </div>
      )}

      {!compact && (
        <div className="lb-foot">
          <span className="lb-sub">Step {Math.min(currentIndex + 1, steps.length)} of {steps.length}</span>
          {remaining.length > 0 && (
            <span className="lb-remaining">
              <span className="lb-sub">Remaining:</span>
              {(remaining.length > 3 ? remaining.slice(0, 2) : remaining).map((s, i) => (
                <span key={s.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  {i > 0 && <span className="lb-arrow">→</span>}
                  <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10 }}>{s.label}</span>
                </span>
              ))}
              {remaining.length > 3 && (
                <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10 }}>
                  +{remaining.length - 2} more
                </span>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
