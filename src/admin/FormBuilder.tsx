import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode, type Service } from '../lib/types'
import type { FormField } from '../pages/RequestForm'

interface ServiceRow extends Service {
  form_schema: FormField[]
}

const FIELD_TYPES: FormField['type'][] = [
  'text',
  'longtext',
  'number',
  'amount',
  'date',
  'dropdown',
]

export function FormBuilder() {
  const { hasRole } = useAuth()
  const [services, setServices] = useState<ServiceRow[]>([])
  const [serviceId, setServiceId] = useState<string>('')
  const [fields, setFields] = useState<FormField[]>([])
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('services')
      .select('id, dept, code, name, description, form_schema')
      .eq('is_active', true)
      .order('dept')
      .order('name')
      .then(({ data, error: e }) => {
        if (e) return setError(e.message)
        const all = (data as ServiceRow[]) ?? []
        const editable = all.filter(
          (s) => hasRole('system_admin') || hasRole('dept_admin', s.dept)
        )
        setServices(editable)
        if (editable.length > 0) {
          setServiceId(editable[0].id)
          setFields(editable[0].form_schema ?? [])
        }
      })
  }, [hasRole])

  const service = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId])

  const pick = (id: string) => {
    setServiceId(id)
    setFields(services.find((s) => s.id === id)?.form_schema ?? [])
    setDirty(false)
    setNote(null)
    setError(null)
  }

  const patch = (i: number, p: Partial<FormField>) => {
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)))
    setDirty(true)
    setNote(null)
  }

  const move = (i: number, dir: -1 | 1) => {
    setFields((fs) => {
      const next = [...fs]
      const j = i + dir
      if (j < 0 || j >= next.length) return fs
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
    setDirty(true)
  }

  const addField = () => {
    const n = fields.length + 1
    setFields((fs) => [
      ...fs,
      { key: `field_${Date.now() % 100000}`, label: `New field ${n}`, type: 'text', visible: true, required: false },
    ])
    setDirty(true)
  }

  const save = async () => {
    setError(null)
    const { error: e } = await supabase
      .from('services')
      .update({ form_schema: fields })
      .eq('id', serviceId)
    if (e) setError(e.message)
    else {
      setDirty(false)
      setNote('Saved — new requests use this form immediately')
      setServices((ss) => ss.map((s) => (s.id === serviceId ? { ...s, form_schema: fields } : s)))
    }
  }

  if (services.length === 0) {
    return <p className="page-sub">{error ?? 'No services you can edit.'}</p>
  }
  const c = service ? DEPT_COLOR[service.dept as DeptCode] : null

  return (
    <>
      <h2 className="page-head">Form builder</h2>
      <p className="page-sub">
        Configure each service form without touching code. Validation is enforced server-side
        against the saved schema.
      </p>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 14 }}>
        <select className="input" style={{ maxWidth: 340 }} value={serviceId} onChange={(e) => pick(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.dept} · {s.code} — {s.name}
            </option>
          ))}
        </select>
        {c && service && (
          <span className="tile-code" style={{ background: c.soft, color: c.rail }}>
            {service.code}
          </span>
        )}
        <button className="btn primary" style={{ marginLeft: 'auto' }} onClick={save} disabled={!dirty}>
          Save form
        </button>
      </div>

      <div className="card">
        <div className="row" style={{ fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ width: 44 }}>Order</span>
          <span style={{ flex: 1 }}>Label</span>
          <span style={{ width: 110 }}>Type</span>
          <span style={{ width: 60 }}>Visible</span>
          <span style={{ width: 66 }}>Required</span>
          <span style={{ width: 30 }} />
        </div>
        {fields.map((f, i) => (
          <div className="row" key={i} style={{ opacity: f.visible === false ? 0.55 : 1 }}>
            <span style={{ width: 44, display: 'flex', gap: 2 }}>
              <button className="btn" style={{ padding: '2px 6px' }} onClick={() => move(i, -1)} aria-label="Move up">↑</button>
              <button className="btn" style={{ padding: '2px 6px' }} onClick={() => move(i, 1)} aria-label="Move down">↓</button>
            </span>
            <input
              className="input"
              style={{ flex: 1 }}
              value={f.label}
              onChange={(e) => patch(i, { label: e.target.value })}
            />
            <select
              className="input"
              style={{ width: 110 }}
              value={f.type}
              onChange={(e) => patch(i, { type: e.target.value as FormField['type'] })}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <span style={{ width: 60 }}>
              <button
                className={`toggle${f.visible !== false ? ' on' : ''}`}
                onClick={() => patch(i, { visible: f.visible === false })}
                aria-label={`visible: ${f.visible !== false}`}
              />
            </span>
            <span style={{ width: 66 }}>
              <button
                className={`toggle${f.required ? ' on' : ''}`}
                onClick={() => patch(i, { required: !f.required })}
                aria-label={`required: ${!!f.required}`}
              />
            </span>
            <button
              className="btn"
              style={{ width: 30, padding: '2px 6px', color: 'var(--red)' }}
              onClick={() => { setFields((fs) => fs.filter((_, j) => j !== i)); setDirty(true) }}
              aria-label="Remove field"
            >
              ×
            </button>
          </div>
        ))}
        {f_dropdown_hint(fields)}
        <div className="row">
          <button className="btn" style={{ borderStyle: 'dashed' }} onClick={addField}>
            + Add field
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
            {dirty ? 'Unsaved changes' : note ?? 'Form changes are audit-logged'}
          </span>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}

function f_dropdown_hint(fields: FormField[]) {
  const dd = fields.filter((f) => f.type === 'dropdown' && (!f.options || f.options.length === 0))
  if (dd.length === 0) return null
  return (
    <div className="row" style={{ fontSize: 11.5, color: 'var(--amber)' }}>
      Dropdown fields without options yet: {dd.map((f) => f.label).join(', ')} — options editing
      arrives with the next iteration; existing options are preserved.
    </div>
  )
}
