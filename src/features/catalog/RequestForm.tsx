import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type Service } from '../../lib/types'
import { FileUpload } from '../../components/FileUpload'
import { PersonPicker } from '../../components/PersonPicker'
import { Toggle } from '../../components/ui'
import { validateSubmission, type FieldValue } from '../../lib/formValidate'
import { effectiveFields, type FieldRule, type RuleValues } from '../../lib/formRules'

export interface FormField {
  key: string
  label: string
  type:
    | 'text' | 'longtext' | 'number' | 'amount' | 'date' | 'dropdown'
    | 'yesno' | 'costcenter' | 'attachment' | 'asset_picker' | 'employee_picker'
  options?: string[]
  visible?: boolean
  required?: boolean
  /** show/require-if conditions evaluated live against other fields */
  rules?: FieldRule[]
  /** layout width in the request form: full row (default) or half row */
  width?: 'full' | 'half'
}

interface ServiceWithForm extends Service {
  form_schema: FormField[]
}

interface CostCenter { code: string; name: string }
interface OwnAsset { id: string; tag: string; model: string | null }
interface Person { id: string; display_name: string }

export function RequestForm({
  service,
  onDone,
}: {
  service: ServiceWithForm
  onDone: () => void
}) {
  const { session } = useAuth()
  const allFields = service.form_schema ?? []
  const [values, setValues] = useState<Record<string, string>>({})
  const [attachments, setAttachments] = useState<string[]>([])
  const [missing, setMissing] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [createdRef, setCreatedRef] = useState<string | null>(null)
  // pre-generated so attachment fields can stage uploads before the row exists
  const requestId = useMemo(() => crypto.randomUUID(), [])
  const c = DEPT_COLOR[service.dept]

  const needs = (t: FormField['type']) => allFields.some((f) => f.type === t)
  const [costCenters, setCostCenters] = useState<CostCenter[]>([])
  const [ownAssets, setOwnAssets] = useState<OwnAsset[]>([])
  const [people, setPeople] = useState<Person[]>([])

  useEffect(() => {
    if (needs('costcenter')) {
      supabase.from('cost_centers').select('code, name').eq('is_active', true).order('code')
        .then(({ data }) => setCostCenters((data as CostCenter[]) ?? []))
    }
    if (needs('asset_picker')) {
      supabase.from('assets').select('id, tag, model')
        .eq('assigned_to', session!.user.id).eq('status', 'assigned').order('tag')
        .then(({ data }) => setOwnAssets((data as OwnAsset[]) ?? []))
    }
    if (needs('employee_picker')) {
      supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name')
        .then(({ data }) => setPeople((data as Person[]) ?? []))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [service.id])

  const set = (key: string, v: string) => setValues((s) => ({ ...s, [key]: v }))

  /** what actually gets stored in requests.payload */
  const fieldValue = (f: FormField): FieldValue => {
    if (f.type === 'yesno') return values[f.key] === 'true'
    if (f.type === 'attachment') return attachments
    return values[f.key]
  }

  // live show/require-if evaluation: hidden fields are not rendered, not
  // submitted, and never required (the SQL validator re-runs the same rules)
  const ruleValues: RuleValues = {}
  for (const f of allFields) ruleValues[f.key] = fieldValue(f)
  const fields = effectiveFields(allFields, ruleValues)

  const submit = async () => {
    const bag: Record<string, FieldValue> = {}
    for (const f of fields) bag[f.key] = fieldValue(f)
    const problems = validateSubmission(fields, bag, {
      costCenters: costCenters.length ? costCenters.map((x) => x.code) : undefined,
      ownedAssetIds: ownAssets.length ? ownAssets.map((x) => x.id) : undefined,
    })
    setMissing(problems.map((p) => p.key))
    if (problems.length > 0) return
    setBusy(true)
    setError(null)
    const amountField = fields.find((f) => f.type === 'amount')
    const firstText = fields.find((f) => f.type === 'text' || f.type === 'dropdown')
    const payload: Record<string, FieldValue> = {}
    for (const f of fields) {
      const v = fieldValue(f)
      if (v == null || v === '') continue
      payload[f.key] = v
    }
    const { data, error: e } = await supabase
      .from('requests')
      .insert({
        id: requestId,
        service_id: service.id,
        dept: service.dept,
        requester_id: session!.user.id,
        title: firstText?.key && values[firstText.key]
          ? `${service.name} — ${values[firstText.key]}`
          : service.name,
        payload,
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

  const control = (f: FormField) => {
    switch (f.type) {
      case 'longtext':
        return (
          <textarea className="input" rows={3} value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)} />
        )
      case 'dropdown':
        return (
          <select className="input" value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">Select…</option>
            {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        )
      case 'yesno':
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 4 }}>
            <Toggle on={values[f.key] === 'true'} label={f.label}
              onChange={() => set(f.key, values[f.key] === 'true' ? 'false' : 'true')} />
            <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
              {values[f.key] === 'true' ? 'Yes' : 'No'}
            </span>
          </div>
        )
      case 'costcenter':
        return (
          <select className="input" value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">Select a cost center…</option>
            {costCenters.map((cc) => <option key={cc.code} value={cc.code}>{cc.code} — {cc.name}</option>)}
          </select>
        )
      case 'attachment':
        return (
          <FileUpload requestId={requestId} compact
            onChanged={setAttachments} onError={setError} />
        )
      case 'asset_picker':
        return (
          <select className="input" value={values[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)}>
            <option value="">{ownAssets.length ? 'Select one of your assets…' : 'No assets assigned to you'}</option>
            {ownAssets.map((a) => <option key={a.id} value={a.id}>{a.tag}{a.model ? ` — ${a.model}` : ''}</option>)}
          </select>
        )
      case 'employee_picker':
        return (
          <PersonPicker people={people} value={values[f.key] || null}
            placeholder="Search for a person…" onPick={(p) => set(f.key, p.id)} />
        )
      default:
        return (
          <input className="input"
            type={f.type === 'date' ? 'date' : f.type === 'text' ? 'text' : 'number'}
            value={values[f.key] ?? ''}
            onChange={(e) => set(f.key, e.target.value)}
            placeholder={f.type === 'amount' ? 'SAR' : undefined} />
        )
    }
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
          {control(f)}
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
