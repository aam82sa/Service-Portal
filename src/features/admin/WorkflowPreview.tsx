import { useMemo, useState } from 'react'
import { LifecycleBar, type LifecycleStep } from '../../components/LifecycleBar'
import {
  offPathStates, previewConsequence, previewPath, requesterSequence, stepLabel,
  type Audience, type BannerTone,
} from '../../lib/workflowPreview'
import type { WorkflowGraph, WorkflowIssue } from '../../lib/workflowValidate'
import './workflowDesigner.css'

const TONE_CHIP: Record<BannerTone, { bg: string; fg: string }> = {
  accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  amber: { bg: 'var(--amber-soft)', fg: 'var(--amber-ink)' },
  red: { bg: 'var(--red-soft)', fg: 'var(--red)' },
  muted: { bg: 'var(--surface)', fg: 'var(--muted)' },
}

export interface PreviewProps {
  graph: WorkflowGraph
  issues: WorkflowIssue[]
  /** "v4 draft" (amber), "v3 published" (green), or "platform defaults" (muted) */
  versionChip: { text: string; tone: 'amber' | 'green' | 'muted' }
}

/**
 * Preview strip (WORKFL1 branch 6): renders the REAL LifecycleBar the request
 * page uses, fed from the draft graph, with an Agent/Requester toggle,
 * off-path states as banner chips, and a plain-language consequence line.
 */
export function WorkflowPreview({ graph, issues, versionChip }: PreviewProps) {
  const [audience, setAudience] = useState<Audience>('agent')

  const path = useMemo(() => previewPath(graph), [graph])
  const steps: LifecycleStep[] = useMemo(
    () => path.map((id) => ({ key: id, label: stepLabel(graph, id, audience) })),
    [path, graph, audience],
  )
  const banners = useMemo(() => offPathStates(graph, audience), [graph, audience])
  const consequence = useMemo(() => previewConsequence(graph, issues), [graph, issues])
  // show the bar mid-flight so done/current/next states all render
  const currentIndex = Math.min(2, steps.length - 1)

  return (
    <div className="preview">
      <div className="pv-head">
        <span className="pv-title">Preview — resulting lifecycle</span>
        <div className="seg" role="tablist" aria-label="Preview audience">
          <button className={audience === 'agent' ? 'on' : ''} role="tab" aria-selected={audience === 'agent'} onClick={() => setAudience('agent')}>
            Agent
          </button>
          <button className={audience === 'requester' ? 'on' : ''} role="tab" aria-selected={audience === 'requester'} onClick={() => setAudience('requester')}>
            Requester
          </button>
        </div>
        <span className={`chip t-${versionChip.tone}`}>{versionChip.text}</span>
        <span className="tool-spacer" />
        <span style={{ fontSize: 10.5, color: 'var(--muted)' }}>
          Rendered with the same LifecycleBar the request page uses
        </span>
      </div>

      <LifecycleBar steps={steps} currentIndex={currentIndex} />

      {banners.length > 0 && (
        <div className="pv-side">
          <span className="lbl">Off-path states shown as banners:</span>
          {banners.map((b) => {
            const t = TONE_CHIP[b.tone]
            return <span key={b.id} className="chip" style={{ background: t.bg, color: t.fg }}>{b.label}</span>
          })}
        </div>
      )}

      <p className="pv-cap">
        Requester wording for the same graph:{' '}
        <span className="mono">{requesterSequence(graph)}</span>.
        {consequence && <> {consequence}</>}
      </p>
    </div>
  )
}
