import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode, type Service } from '../../lib/types'
import type { FormField } from '../catalog/RequestForm'

interface ServiceRow extends Service {
  form_schema: FormField[]
  parent_id: string | null
}

const FIELD_TYPES: FormField['type'][] = [
  'text',
  'longtext',
  'number',
  'amount',
  'date',
  'dropdown',
  'yesno',
  'costcenter',
  'attachment',
  'asset_picker',
  'employee_picker',
]

/** builder hint shown under rows for types with server-backed data */
const TYPE_HINT: Partial<Record<FormField['type'], string>> = {
  costcenter: 'options come from the admin-maintained cost-center list below',
  attachment: 'files upload to secure storage; required = at least one file',
  asset_picker: "lists the requester's own assigned assets",
  employee_picker: 'searchable picker over active people',
  yesno: 'stored as a true/false value',
}

export function FormBuilder() {
  const { hasRole } = useAuth()
  const [services, setServices] = useState<ServiceRow[]>([])
  const [serviceId, setServiceId] = useState<string>('')
  const [fields, setFields] = useState<FormField[]>([])
  const [optDrafts, setOptDrafts] = useState<Record<number, string>>({})
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('services')
      .select('id, dept, code, name, description, form_schema, parent_id')
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

      {fields.length === 0 && service?.parent_id && (() => {
        const parent = services.find((s) => s.id === service.parent_id)
        if (!parent || (parent.form_schema ?? []).length === 0) return null
        return (
          <div style={{ background: 'var(--it-soft)', color: 'var(--it)', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ flex: 1 }}>
              This child service inherits {parent.form_schema.length} fields from {parent.code} — {parent.name}.
              Copy them here to customize.
            </span>
            <button className="btn" onClick={() => { setFields(parent.form_schema); setDirty(true) }}>
              Copy parent form
            </button>
          </div>
        )
      })()}
      <div className="card">
        <div className="row" style={{ fontSize: 11, color: 'var(--muted)' }}>
          <span style={{ width: 60 }}>Drag / order</span>
          <span style={{ flex: 1 }}>Label</span>
          <span style={{ width: 110 }}>Type</span>
          <span style={{ width: 64 }}>Width</span>
          <span style={{ width: 60 }}>Visible</span>
          <span style={{ width: 66 }}>Required</span>
          <span style={{ width: 30 }} />
        </div>
        {fields.map((f, i) => (
          <div
            key={i}
            draggable
            onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const from = Number(e.dataTransfer.getData('text/plain'))
              if (Number.isNaN(from) || from === i) return
              setFields((fs) => {
                const next = [...fs]
                const [item] = next.splice(from, 1)
                next.splice(i, 0, item)
                return next
              })
              setDirty(true)
            }}
          >
          <div className="row" style={{ opacity: f.visible === false ? 0.55 : 1 }}>
            <span style={{ width: 60, display: 'flex', gap: 2, alignItems: 'center' }}>
              <span style={{ cursor: 'grab', color: 'var(--muted)', fontSize: 14, padding: '0 2px' }} title="Drag to reorder">⠿</span>
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
              style={{ width: 130 }}
              value={f.type}
              onChange={(e) => patch(i, { type: e.target.value as FormField['type'] })}
            >
              {FIELD_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <button
              className="btn mono"
              style={{ width: 64, padding: '4px 6px', fontSize: 10.5 }}
              title="Toggle field width in the form"
              onClick={() => patch(i, { width: f.width === 'half' ? 'full' : 'half' })}
            >
              {f.width === 'half' ? '◧ half' : '▭ full'}
            </button>
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
          {TYPE_HINT[f.type] && (
            <div className="row" style={{ paddingLeft: 56, background: 'var(--surface)', fontSize: 11, color: 'var(--muted)' }}>
              {TYPE_HINT[f.type]}
            </div>
          )}
          {f.type === 'dropdown' && (
            <div className="row" style={{ paddingLeft: 56, background: 'var(--surface)', gap: 6, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--muted)' }}>options</span>
              {(f.options ?? []).map((o) => (
                <span key={o} className="chip" style={{ background: 'var(--card)', color: 'var(--ink)', border: '1px solid var(--line)', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                  {o}
                  <span
                    style={{ cursor: 'pointer', color: 'var(--red)' }}
                    onClick={() => patch(i, { options: (f.options ?? []).filter((x) => x !== o) })}
                  >
                    ×
                  </span>
                </span>
              ))}
              <input
                className="input"
                style={{ width: 140, padding: '4px 8px', fontSize: 12 }}
                placeholder="Add option + Enter"
                value={optDrafts[i] ?? ''}
                onChange={(e) => setOptDrafts((s) => ({ ...s, [i]: e.target.value }))}
                onKeyDown={(e) => {
                  const v = (optDrafts[i] ?? '').trim()
                  if (e.key === 'Enter' && v && !(f.options ?? []).includes(v)) {
                    patch(i, { options: [...(f.options ?? []), v] })
                    setOptDrafts((s) => ({ ...s, [i]: '' }))
                  }
                }}
              />
            </div>
          )}
          </div>
        ))}
        <div className="row">
          <button className="btn" style={{ borderStyle: 'dashed' }} onClick={addField}>
            + Add field
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)', marginLeft: 'auto' }}>
            {dirty ? 'Unsaved changes' : note ?? 'Form changes are audit-logged'}
          </span>
        </div>
      </div>

      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '14px 0 6px' }}>
        Layout canvas — drag fields where they should appear · click ⇔ to resize
      </div>
      <div className="card" style={{ padding: '14px 16px', background: 'var(--surface)' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 4%' }}>
          {fields.map((f, i) => (
            <div
              key={i}
              draggable
              onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault()
                const from = Number(e.dataTransfer.getData('text/plain'))
                if (Number.isNaN(from) || from === i) return
                setFields((fs) => {
                  const next = [...fs]
                  const [item] = next.splice(from, 1)
                  next.splice(i, 0, item)
                  return next
                })
                setDirty(true)
              }}
              style={{
                width: f.width === 'half' ? '48%' : '100%',
                background: 'var(--card)', border: '1.5px dashed var(--line)', borderRadius: 9,
                padding: '8px 10px', cursor: 'grab',
                opacity: f.visible === false ? 0.45 : 1,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--muted)', fontSize: 12 }}>⠿</span>
                <span style={{ fontSize: 11.5, fontWeight: 500, flex: 1 }}>
                  {f.label}{f.required && <span style={{ color: 'var(--red)' }}> *</span>}
                </span>
                <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 9.5 }}>{f.type}</span>
                <button
                  className="btn" style={{ padding: '1px 7px', fontSize: 11 }}
                  title="Toggle full / half width"
                  onClick={() => patch(i, { width: f.width === 'half' ? 'full' : 'half' })}
                >
                  ⇔
                </button>
              </div>
              <div style={{
                marginTop: 5, background: 'var(--surface)', borderRadius: 6,
                height: f.type === 'longtext' ? 34 : 20, border: '1px solid var(--line)',
              }} />
            </div>
          ))}
          {fields.length === 0 && <span className="row-desc">No fields yet — add them above.</span>}
        </div>
      </div>
      <CostCenterAdmin onError={setError} />
      {error && <p className="error-note">{error}</p>}
    </>
  )
}

interface CostCenterRow { code: string; name: string; dept: string | null; is_active: boolean }

/** The admin-maintained list backing `costcenter` fields. */
function CostCenterAdmin({ onError }: { onError: (m: string) => void }) {
  const { hasRole } = useAuth()
  const canEdit = hasRole('system_admin') || hasRole('dept_admin')
  const [rows, setRows] = useState<CostCenterRow[]>([])
  const [code, setCode] = useState('')
  const [name, setName] = useState('')

  const load = () => {
    supabase.from('cost_centers').select('code, name, dept, is_active').order('code')
      .then(({ data }) => setRows((data as CostCenterRow[]) ?? []))
  }
  useEffect(load, [])

  const add = async () => {
    const { error } = await supabase.from('cost_centers').insert({ code: code.trim().toUpperCase(), name: name.trim() })
    if (error) onError(error.message)
    setCode(''); setName('')
    load()
  }

  const toggle = async (r: CostCenterRow) => {
    const { error } = await supabase.from('cost_centers').update({ is_active: !r.is_active }).eq('code', r.code)
    if (error) onError(error.message)
    load()
  }

  return (
    <>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', margin: '14px 0 6px' }}>
        Cost centers — options for costcenter fields
      </div>
      <div className="card">
        {rows.map((r) => (
          <div className="row" key={r.code} style={{ opacity: r.is_active ? 1 : 0.55 }}>
            <span className="mono" style={{ width: 110, fontSize: 12 }}>{r.code}</span>
            <span style={{ flex: 1, fontSize: 13 }}>{r.name}</span>
            <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{r.dept ?? 'shared'}</span>
            {canEdit && (
              <button className={`toggle${r.is_active ? ' on' : ''}`} onClick={() => toggle(r)} aria-label={`${r.code} active`} />
            )}
          </div>
        ))}
        {rows.length === 0 && <div className="row row-desc">No cost centers yet.</div>}
        {canEdit && (
          <div className="row" style={{ gap: 8 }}>
            <input className="input" style={{ width: 130 }} placeholder="CC-XX-00" value={code} onChange={(e) => setCode(e.target.value)} />
            <input className="input" style={{ flex: 1 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
            <button className="btn primary" onClick={add} disabled={!code.trim() || !name.trim()}>Add</button>
          </div>
        )}
      </div>
    </>
  )
}

