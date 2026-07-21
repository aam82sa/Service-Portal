import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { StatusChip } from '../../components/ui'
import type { WorkflowTransition } from '../../lib/workflowValidate'

interface Props {
  serviceId: string
  fromVersion: number | null
  toVersion: number
  removed: WorkflowTransition[]
  /** distinct from-states of the removed transitions */
  fromStates: string[]
  onCancel: () => void
  onConfirm: () => void
}

interface AffectedRow { ref: string; status: string }

/**
 * Publish impact dialog (WORKFL1 Part 2). Reuses the config lifecycle dialog
 * shell to make a breaking-looking publish transparent: when the new graph
 * removes a transition, it surfaces the in-flight requests currently sitting on
 * that step. Version pinning (00077) means those requests finish on the version
 * they started on — this dialog states that plainly so the admin publishes with
 * eyes open; only NEW requests get the new graph.
 */
export function WorkflowPublishDialog({ serviceId, fromVersion, toVersion, removed, fromStates, onCancel, onConfirm }: Props) {
  const [rows, setRows] = useState<AffectedRow[] | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    supabase.from('requests')
      .select('ref, status')
      .eq('service_id', serviceId)
      .in('status', fromStates)
      .not('status', 'in', '("resolved","closed","cancelled")')
      .order('ref')
      .then(({ data }) => { if (live) setRows((data as AffectedRow[]) ?? []) })
    return () => { live = false }
  }, [serviceId, fromStates])

  const affected = rows?.length ?? 0

  return (
    <div className="cfg-overlay" role="dialog" aria-modal="true" aria-label="Confirm workflow publish"
         onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <div className="cfg-modal">
        <div className="cfg-head">
          <h3>Publish v{toVersion}</h3>
          <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
            {fromVersion ? `from v${fromVersion}` : 'from defaults'}
          </span>
        </div>

        <p className="cfg-sub">
          This version removes {removed.length} transition{removed.length === 1 ? '' : 's'}. Existing in-flight
          requests finish on the version they started on — only new requests use v{toVersion}.
        </p>

        <div className="cfg-block">
          <div className="cfg-block-head"><span>Removed transitions</span></div>
          <div className="cfg-chips">
            {removed.map((t) => (
              <span key={`${t.from}-${t.to}`} className="cfg-count">
                <StatusChip status={t.from} /> <span aria-hidden>→</span> <StatusChip status={t.to} />
              </span>
            ))}
          </div>
        </div>

        <div className="cfg-block">
          <div className="cfg-block-head">
            <span>In-flight requests on {affected === 1 ? 'this step' : 'these steps'}</span>
            <strong>{rows === null ? '…' : affected}</strong>
          </div>
          {affected > 0 ? (
            <>
              <div className="cfg-refs">
                {rows!.slice(0, 12).map((r) => <span key={r.ref} className="chip mono">{r.ref}</span>)}
                {affected > 12 && <span className="row-desc">+{affected - 12} more</span>}
              </div>
              <p className="cfg-note-line">
                These keep v{fromVersion} (pinned) and are unaffected. The change applies to new requests only.
              </p>
            </>
          ) : (
            <p className="cfg-sub" style={{ margin: 0 }}>
              {rows === null ? 'Checking…' : 'No in-flight requests sit on a removed step — nothing is affected.'}
            </p>
          )}
        </div>

        <div className="cfg-actions">
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn primary" disabled={rows === null || busy}
                  onClick={() => { setBusy(true); onConfirm() }}>
            {busy ? 'Publishing…' : `Publish v${toVersion}`}
          </button>
        </div>
      </div>
    </div>
  )
}
