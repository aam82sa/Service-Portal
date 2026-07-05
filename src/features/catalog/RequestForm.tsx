import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type Service } from '../../lib/types'

export interface FormField {
  key: string
  label: string
  type: 'text' | 'longtext' | 'number' | 'amount' | 'date' | 'dropdown'
  options?: string[]
  visible?: boolean
  required?: boolean
  /** layout width in the request form: full row (default) or half row */
  width?: 'full' | 'half'
}

interface ServiceWithForm extends Service {
  form_schema: FormField[]
}

export function RequestForm({
  service,
  onDone,
}: {
  service: ServiceWithForm
  onDone: () => void
}) {
  const { session } = useAuth()
  const fields = (service.form_schema ?? []).filter((f) => f.visible !== false)
  const [values, setValues] = useState<Record<string, string>>({})
  const [missing, setMissing] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createdRef, setCreatedRef] = useState<string | null>(null)
  const c = DEPT_COLOR[service.dept]

  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }))

  const submit = async () => {
    const gaps = fields.filter((f) => f.required && !values[f.key]?.trim()).map((f) => f.key)
    setMissing(gaps)
    if (gaps.length > 0) return
    setBusy(true)
    setError(null)
    const amountField = fields.find((f) => f.type === 'amount')
    const firstText = fields.find((f) => f.type === 'text' || f.type === 'dropdown')
    const { data, error: e } = await supabase
      .from('requests')
      .insert({
        service_id: service.id,
        dept: service.dept,
        requester_id: session!.user.id,
        title: firstText?.key && values[firstText.key]
          ? `${service.name} — ${values[firstText.key]}`
          : service.name,
        payload: values,
        amount: amountField && values[amountField.key] ? Number(values[amountField.key]) : null,
      })
      .select('ref')
      .single()
    setBusy(false)
    if (e) setError(e.message)
    else setCreatedRef((data as { ref: string }).ref)
  }

  if (createdRef) {
    return (
      <div className="card" style={{ maxWidth: 520, padding: 28 }}>
        <h2 style={{ fontSize: 17, marginBottom: 8 }}>Request submitted</h2>
        <p style={{ color: 'var(--muted)', fontSize: 13, margin: '0 0 6px' }}>
          Your reference number:
        </p>
        <p className="mono" style={{ fontSize: 22, color: 'var(--accent)', margin: '0 0 20px' }}>
          {createdRef}
        </p>
        <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '0 0 20px' }}>
          Track it under My requests. You will be notified as it progresses.
        </p>
        <button className="btn primary" onClick={onDone}>
          Back to portal
        </button>
      </div>
    )
  }

  return (
    <div className="card" style={{ maxWidth: 560, padding: 28 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
        <span className="tile-code" style={{ background: c.soft, color: c.rail }}>
          {service.code}
        </span>
        <h2 style={{ fontSize: 17 }}>{service.name}</h2>
      </div>
      <p style={{ color: 'var(--muted)', fontSize: 12.5, margin: '0 0 20px' }}>
        {service.description} · {c.label}
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 4%' }}>
      {fields.map((f) => (
        <div key={f.key} style={{ marginBottom: 14, width: f.width === 'half' ? '48%' : '100%' }}>
          <label className="field-label">
            {f.label}
            {f.required && <span style={{ color: 'var(--red)' }}> *</span>}
          </label>
          {f.type === 'longtext' ? (
            <textarea
              className="input"
              rows={3}
              value={values[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
            />
          ) : f.type === 'dropdown' ? (
            <select
              className="input"
              value={values[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
            >
              <option value="">Select…</option>
              {(f.options ?? []).map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          ) : (
            <input
              className="input"
              type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'}
              value={values[f.key] ?? ''}
              onChange={(e) => set(f.key, e.target.value)}
              placeholder={f.type === 'amount' ? 'SAR' : undefined}
            />
          )}
          {missing.includes(f.key) && (
            <div style={{ color: 'var(--red)', fontSize: 11.5, marginTop: 3 }}>
              This field is required
            </div>
          )}
        </div>
      ))}
      </div>

      <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
        <button className="btn primary" onClick={submit} disabled={busy}>
          {busy ? 'Submitting…' : 'Submit request'}
        </button>
        <button className="btn" onClick={onDone} disabled={busy}>
          Cancel
        </button>
      </div>
      {error && <p className="error-note">{error}</p>}
    </div>
  )
}
