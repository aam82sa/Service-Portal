import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface DoaRow {
  id: string
  dept: string | null
  service_id: string | null
  min_amount: number
  max_amount: number | null
  step_order: number
  approver_role: string
  approver_hint: string | null
}

interface Step { approver_hint: string; approver_role: string }
interface Band { min_amount: number; max_amount: number | null; steps: Step[] }

const ROLES = ['approver', 'cybersecurity', 'executive', 'system_admin']

const sar = (n: number) => n.toLocaleString()

/** platform rows -> ordered band structure */
function toBands(rows: DoaRow[]): Band[] {
  const key = (r: DoaRow) => `${r.min_amount}|${r.max_amount ?? ''}`
  const map = new Map<string, Band>()
  for (const r of [...rows].sort((a, b) => a.min_amount - b.min_amount || a.step_order - b.step_order)) {
    const k = key(r)
    if (!map.has(k)) map.set(k, { min_amount: r.min_amount, max_amount: r.max_amount, steps: [] })
    map.get(k)!.steps.push({ approver_hint: r.approver_hint ?? '', approver_role: r.approver_role })
  }
  return [...map.values()]
}

/**
 * Platform DoA bands (SAR thresholds -> approval chain). The whole set is
 * saved atomically through save_doa_bands(), which rejects gaps, overlaps,
 * a bounded last band, and empty chains — and audit-logs every save.
 */
export function DoaMatrix() {
  const [bands, setBands] = useState<Band[]>([])
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [probe, setProbe] = useState('')

  const load = useCallback(() => {
    supabase.from('doa_matrix').select('*')
      .is('dept', null).is('service_id', null)
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setBands(toBands((data as DoaRow[]) ?? []))
        setDirty(false)
      })
  }, [])
  useEffect(load, [load])

  const patch = (i: number, b: Partial<Band>) => {
    setBands((bs) => bs.map((x, j) => (j === i ? { ...x, ...b } : x)))
    setDirty(true)
    setNote(null)
  }

  // ceilings drive the next band's floor, so edits stay contiguous by construction
  const setCeiling = (i: number, v: number) => {
    setBands((bs) => bs.map((x, j) =>
      j === i ? { ...x, max_amount: v } : j === i + 1 ? { ...x, min_amount: v } : x))
    setDirty(true)
    setNote(null)
  }

  const addBand = () => {
    setBands((bs) => {
      const last = bs[bs.length - 1]
      const floor = last ? (last.min_amount + (last.max_amount ?? last.min_amount + 100000)) : 0
      const capped = bs.map((x, j) => (j === bs.length - 1 ? { ...x, max_amount: floor } : x))
      return [...capped, { min_amount: floor, max_amount: null, steps: [{ approver_hint: 'Line manager', approver_role: 'approver' }] }]
    })
    setDirty(true)
  }

  const removeBand = (i: number) => {
    setBands((bs) => {
      const next = bs.filter((_, j) => j !== i)
      // reclose the coverage: stretch the neighbour over the removed range
      if (next.length > 0) {
        if (i === 0) next[0] = { ...next[0], min_amount: 0 }
        else next[i - 1] = { ...next[i - 1], max_amount: i < bs.length - 1 ? bs[i].max_amount : null }
      }
      return next
    })
    setDirty(true)
  }

  const save = async () => {
    setError(null)
    const { error: e } = await supabase.rpc('save_doa_bands', { p_bands: bands })
    if (e) setError(e.message)
    else {
      setNote('Saved — new requests build chains from the updated bands. Audit-logged.')
      load()
    }
  }

  const probeBand = useMemo(() => {
    const amt = Number(probe)
    if (!Number.isFinite(amt) || probe.trim() === '') return null
    return bands.find((b) => amt >= b.min_amount && (b.max_amount == null || amt < b.max_amount)) ?? null
  }, [probe, bands])

  return (
    <>
      <h2 className="page-head">DoA matrix</h2>
      <p className="page-sub">
        Platform-wide delegation-of-authority bands: a request's amount picks its band, the
        band defines the approval chain. Service- and department-specific rows (managed in
        their catalogs) override these. Bands must cover 0 → ∞ with no gaps — the save is
        rejected otherwise.
      </p>

      {bands.map((b, i) => (
        <div className="card" key={i} style={{ marginBottom: 12 }}>
          <div className="row" style={{ background: 'var(--surface)', gap: 10 }}>
            <span className="chip mono" style={{ background: 'var(--card)', color: 'var(--ink)', border: '1px solid var(--line)' }}>
              Tier {i + 1}
            </span>
            <span style={{ fontSize: 13 }}>
              {sar(b.min_amount)} SAR →{' '}
              {b.max_amount == null ? '∞' : (
                <input
                  className="input mono" type="number" style={{ width: 120, padding: '3px 8px', display: 'inline-block' }}
                  value={b.max_amount}
                  onChange={(e) => setCeiling(i, Number(e.target.value))}
                />
              )}
              {b.max_amount != null && ' SAR'}
            </span>
            <span style={{ flex: 1 }} />
            {bands.length > 1 && (
              <button className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }}
                onClick={() => removeBand(i)} aria-label={`Remove tier ${i + 1}`}>
                ×
              </button>
            )}
          </div>
          {b.steps.map((s, j) => (
            <div className="row" key={j} style={{ gap: 8 }}>
              <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>step {j + 1}</span>
              <input className="input" style={{ flex: 1 }} value={s.approver_hint}
                placeholder="Approver (e.g. Department head)"
                onChange={(e) => patch(i, { steps: b.steps.map((x, k) => (k === j ? { ...x, approver_hint: e.target.value } : x)) })} />
              <select className="input" style={{ width: 140 }} value={s.approver_role}
                title="Role required to decide this step"
                onChange={(e) => patch(i, { steps: b.steps.map((x, k) => (k === j ? { ...x, approver_role: e.target.value } : x)) })}>
                {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              {b.steps.length > 1 && (
                <button className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }}
                  onClick={() => patch(i, { steps: b.steps.filter((_, k) => k !== j) })}
                  aria-label="Remove step">
                  ×
                </button>
              )}
            </div>
          ))}
          <div className="row">
            <button className="btn" style={{ borderStyle: 'dashed' }}
              onClick={() => patch(i, { steps: [...b.steps, { approver_hint: '', approver_role: 'approver' }] })}>
              + Add step
            </button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 16 }}>
        <button className="btn" style={{ borderStyle: 'dashed' }} onClick={addBand}>+ Add tier</button>
        <span style={{ flex: 1, fontSize: 11, color: 'var(--muted)' }}>
          {dirty ? 'Unsaved changes' : note ?? ''}
        </span>
        <button className="btn primary" onClick={save} disabled={!dirty}>Save bands</button>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>Preview the chain for an amount:</span>
          <input className="input mono" style={{ width: 140 }} placeholder="e.g. 30000"
            value={probe} onChange={(e) => setProbe(e.target.value)} />
          {probeBand && (
            <span style={{ fontSize: 13 }}>
              {probeBand.steps.map((s, k) => (
                <span key={k}>
                  {k > 0 && ' → '}
                  <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                    {k + 1}. {s.approver_hint || '—'}
                  </span>
                </span>
              ))}
            </span>
          )}
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
