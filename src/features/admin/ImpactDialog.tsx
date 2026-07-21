import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { StatusChip } from '../../components/ui'
import {
  canConfirm, impactHeadline, resolutionOptions,
  type ConfigImpact, type ConfigKind, type Resolution,
} from '../../lib/configLifecycle'

interface Props {
  kind: ConfigKind
  target: { id: string; code: string; label: string }
  /** an optional newer form version to migrate open requests onto */
  migrationTarget?: { id: string; label: string } | null
  onClose: () => void
  onDone: (message: string) => void
}

/**
 * Shared impact dialog (WORKFL1 Part 2, branch 9). Opens on a Retire / Delete
 * gesture for a service, form version or SLA profile, shows the real counts
 * from preview_config_change, and commits the admin's choice through
 * apply_config_change (which re-checks the impact and aborts on drift). The
 * same component backs the workflow designer's Publish when it removes a
 * transition in-flight requests still sit on.
 */
export function ImpactDialog({ kind, target, migrationTarget, onClose, onDone }: Props) {
  const [impact, setImpact] = useState<ConfigImpact | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  const [resolution, setResolution] = useState<Resolution>('finish_old')
  const [note, setNote] = useState('')
  const [typedCode, setTypedCode] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    supabase.rpc('preview_config_change', { p_kind: kind, p_id: target.id, p_change: {} })
      .then(({ data, error }) => {
        if (!live) return
        if (error) setLoadErr(error.message)
        else setImpact(data as ConfigImpact)
      })
    return () => { live = false }
  }, [kind, target.id])

  const hardDelete = !!impact?.can_hard_delete
  const options = useMemo(
    () => (impact ? resolutionOptions(kind, impact, !!migrationTarget) : []),
    [impact, kind, migrationTarget],
  )
  const confirmOk = !!impact && !busy && canConfirm({
    hardDelete, resolution, note, typedCode, code: target.code,
  })

  const commit = async () => {
    if (!impact) return
    setBusy(true); setErr(null)
    const change: Record<string, unknown> = {
      action: hardDelete ? 'delete' : 'retire',
      impact,
    }
    if (!hardDelete && resolution === 'migrate' && migrationTarget) {
      change.to_version_id = migrationTarget.id
    }
    const { data, error } = await supabase.rpc('apply_config_change', {
      p_kind: kind,
      p_id: target.id,
      p_change: change,
      p_resolution: hardDelete ? 'finish_old' : resolution,
      p_note: note.trim(),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    const verb = hardDelete ? 'deleted'
      : resolution === 'close' ? 'retired — open requests cancelled'
      : resolution === 'migrate' ? 'retired — open requests migrated'
      : 'retired'
    onDone(`${target.label} ${verb}. Change recorded (${String(data).slice(0, 8)}).`)
    onClose()
  }

  const refs = impact?.sample_refs ?? []
  const visibleRefs = showAll ? refs : refs.slice(0, 10)

  return (
    <div className="cfg-overlay" role="dialog" aria-modal="true" aria-label={`Retire or delete ${target.label}`}
         onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="cfg-modal">
        <div className="cfg-head">
          <h3>{hardDelete ? 'Delete' : 'Retire'} — {target.label}</h3>
          <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{target.code}</span>
        </div>

        {loadErr && <p className="error-note">{loadErr}</p>}
        {!impact && !loadErr && <p className="cfg-sub">Checking what this change affects…</p>}

        {impact && (
          <>
            <p className="cfg-sub">{impactHeadline(impact)}</p>

            {impact.open_requests > 0 && (
              <div className="cfg-block">
                <div className="cfg-block-head">
                  <span>Affected open requests</span>
                  <strong>{impact.open_requests}</strong>
                </div>
                <div className="cfg-chips">
                  {Object.entries(impact.in_flight_by_status).map(([s, n]) => (
                    <span key={s} className="cfg-count">
                      <StatusChip status={s} /> {n}
                    </span>
                  ))}
                </div>
                <div className="cfg-refs">
                  {visibleRefs.map((r) => <span key={r} className="chip mono">{r}</span>)}
                  {refs.length > 10 && !showAll && (
                    <button className="card-link" onClick={() => setShowAll(true)}>
                      show all {impact.open_requests}
                    </button>
                  )}
                </div>
                {impact.affected_sla_clocks > 0 && (
                  <p className="cfg-note-line">{impact.affected_sla_clocks} of these have a live SLA clock.</p>
                )}
              </div>
            )}

            {!hardDelete && impact.open_requests > 0 && (
              <fieldset className="cfg-opts">
                <legend>What happens to the open requests</legend>
                {options.map((o) => (
                  <label key={o.value} className={`cfg-opt${o.destructive ? ' danger' : ''}${!o.enabled ? ' off' : ''}`}>
                    <input type="radio" name="resolution" value={o.value}
                           disabled={!o.enabled} checked={resolution === o.value}
                           onChange={() => setResolution(o.value)} />
                    <span>
                      <span className="cfg-opt-label">{o.label}</span>
                      <span className="cfg-opt-desc">{o.desc}</span>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            <label className="cfg-field">
              <span>Reason (recorded in the audit trail){note.trim() ? '' : ' *'}</span>
              <textarea className="input" rows={2} value={note} onChange={(e) => setNote(e.target.value)}
                        placeholder="Why is this being retired / deleted?" />
            </label>

            {(hardDelete || resolution === 'close') && (
              <label className="cfg-field">
                <span>Type <code>{target.code}</code> to confirm{hardDelete ? ' deletion' : ' the mass-closure'}</span>
                <input className="input" value={typedCode} onChange={(e) => setTypedCode(e.target.value)}
                       placeholder={target.code} autoComplete="off" />
              </label>
            )}

            {err && <p className="error-note">{err}</p>}

            <div className="cfg-actions">
              <button className="btn" onClick={onClose} disabled={busy}>Cancel</button>
              <button className={`btn ${hardDelete || resolution === 'close' ? 'danger' : 'primary'}`}
                      onClick={commit} disabled={!confirmOk}>
                {busy ? 'Working…' : hardDelete ? 'Delete permanently'
                  : resolution === 'close' ? 'Retire & close requests' : 'Retire'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
