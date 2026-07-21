import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode, type Service } from '../../lib/types'
import type { FormField } from '../catalog/RequestForm'
import type { FieldRule } from '../../lib/formRules'
import { ImpactDialog } from './ImpactDialog'

interface FormVersion {
  id: string
  version: number
  status: 'draft' | 'published' | 'retired'
  published_at: string | null
  retired_at: string | null
}

/**
 * Three-pane no-code form builder (matches
 * prototype/form-builder-reference.html): palette · live canvas ·
 * properties. Same form_schema shape as before — this is a builder UI,
 * not a schema change. Validation stays server-side against the saved
 * schema.
 */

interface ServiceRow extends Service {
  form_schema: FormField[]
  parent_id: string | null
}

const PALETTE: { group: string; items: { type: FormField['type']; label: string; ico: string }[] }[] = [
  {
    group: 'Basic',
    items: [
      { type: 'text', label: 'Text', ico: 'Ab' },
      { type: 'longtext', label: 'Long text', ico: '¶' },
      { type: 'number', label: 'Number', ico: '#' },
      { type: 'amount', label: 'Amount', ico: '$' },
      { type: 'date', label: 'Date', ico: 'Dt' },
    ],
  },
  {
    group: 'Choice',
    items: [
      { type: 'dropdown', label: 'Dropdown', ico: '▾' },
      { type: 'yesno', label: 'Yes / no', ico: 'Y/N' },
    ],
  },
  {
    group: 'Data-backed',
    items: [
      { type: 'costcenter', label: 'Cost center', ico: 'CC' },
      { type: 'attachment', label: 'Attachment', ico: '@' },
      { type: 'asset_picker', label: 'Asset picker', ico: 'As' },
      { type: 'employee_picker', label: 'Employee picker', ico: 'Pp' },
    ],
  },
]

const ALL_TYPES = PALETTE.flatMap((g) => g.items.map((i) => i.type))

const TYPE_HINT: Partial<Record<FormField['type'], string>> = {
  amount: 'Amount fields drive the DoA approval chain — the saved value picks a band in the DoA matrix.',
  costcenter: 'Options come from the admin-maintained cost-center list below the builder.',
  attachment: 'Files upload to secure storage; required means at least one file.',
  asset_picker: "Lists the requester's own assigned assets.",
  employee_picker: 'Searchable picker over active people.',
  yesno: 'Stored as a true/false value — pairs well with show/require conditions.',
}

const RULE_OPS: FieldRule['op'][] = ['eq', 'neq', 'gte', 'lte', 'in']

const OP_TEXT: Record<FieldRule['op'], string> = {
  eq: '=', neq: '≠', gte: '≥', lte: '≤', in: 'in',
}

const condText = (r: FieldRule) =>
  `${r.when} ${OP_TEXT[r.op]} ${Array.isArray(r.value) ? r.value.join(', ') : String(r.value)}`

const sanitizeKey = (v: string) =>
  v.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '')

/** mock input for the live canvas, by field type */
function CanvasInput({ f }: { f: FormField }) {
  if (f.type === 'longtext') return <div className="fb-input tall" />
  if (f.type === 'dropdown' || f.type === 'costcenter' || f.type === 'asset_picker' || f.type === 'employee_picker') {
    const hint = f.type === 'dropdown'
      ? (f.options?.length ? `${f.options[0]}…` : 'Choose…')
      : f.type === 'costcenter' ? 'CC-…' : 'Search…'
    return <div className="fb-input pick">{hint}<span>▾</span></div>
  }
  if (f.type === 'yesno') return <div className="fb-input pick">No<span>◯</span></div>
  if (f.type === 'attachment') return <div className="fb-input pick">Drop files…<span>@</span></div>
  return <div className="fb-input" />
}

export function FormBuilder() {
  const { hasRole } = useAuth()
  const [services, setServices] = useState<ServiceRow[]>([])
  const [serviceId, setServiceId] = useState<string>('')
  const [fields, setFields] = useState<FormField[]>([])
  const [selIdx, setSelIdx] = useState<number | null>(null)
  const [preview, setPreview] = useState(false)
  const [optDraft, setOptDraft] = useState('')
  const [cond, setCond] = useState<{ effect: FieldRule['effect']; when: string; op: FieldRule['op']; value: string }>(
    { effect: 'show', when: '', op: 'eq', value: '' })
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [versions, setVersions] = useState<FormVersion[]>([])
  const [impactVersion, setImpactVersion] = useState<FormVersion | null>(null)

  const loadVersions = (svcId: string) => {
    if (!svcId) { setVersions([]); return }
    supabase.from('form_versions')
      .select('id, version, status, published_at, retired_at')
      .eq('service_id', svcId)
      .order('version', { ascending: false })
      .then(({ data }) => setVersions((data as FormVersion[]) ?? []))
  }

  const restoreVersion = async (v: FormVersion) => {
    const { error: e } = await supabase.from('form_versions')
      .update({ retired_at: null, retired_by: null, retire_reason: null, status: 'published' }).eq('id', v.id)
    if (e) setError(e.message)
    else { setNote(`Form v${v.version} restored.`); loadVersions(serviceId) }
  }

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
          loadVersions(editable[0].id)
        }
      })
  }, [hasRole])

  const service = useMemo(() => services.find((s) => s.id === serviceId), [services, serviceId])
  const sel = selIdx != null ? fields[selIdx] ?? null : null

  const pick = (id: string) => {
    setServiceId(id)
    setFields(services.find((s) => s.id === id)?.form_schema ?? [])
    setSelIdx(null)
    setDirty(false)
    setNote(null)
    setError(null)
    loadVersions(id)
  }

  const patch = (i: number, p: Partial<FormField>) => {
    setFields((fs) => fs.map((f, j) => (j === i ? { ...f, ...p } : f)))
    setDirty(true)
    setNote(null)
  }

  /** renaming a key rewrites conditions on other fields that point at it */
  const renameKey = (i: number, raw: string) => {
    const next = sanitizeKey(raw)
    const old = fields[i]?.key
    setFields((fs) => fs.map((f, j) => {
      if (j === i) return { ...f, key: next }
      if (f.rules?.some((r) => r.when === old)) {
        return { ...f, rules: f.rules.map((r) => (r.when === old ? { ...r, when: next } : r)) }
      }
      return f
    }))
    setDirty(true)
  }

  const addField = (type: FormField['type'], at?: number) => {
    const base = PALETTE.flatMap((g) => g.items).find((i) => i.type === type)
    const f: FormField = {
      key: sanitizeKey(`${type}_${Date.now() % 100000}`),
      label: base?.label ?? 'New field',
      type,
      visible: true,
      required: false,
      width: type === 'longtext' || type === 'attachment' ? 'full' : 'half',
    }
    setFields((fs) => {
      const next = [...fs]
      const idx = at ?? next.length
      next.splice(idx, 0, f)
      setSelIdx(idx)
      return next
    })
    setDirty(true)
  }

  const removeField = (i: number) => {
    setFields((fs) => fs.filter((_, j) => j !== i))
    setSelIdx(null)
    setDirty(true)
  }

  const moveField = (from: number, to: number) => {
    setFields((fs) => {
      const next = [...fs]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
    setSelIdx(to)
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
      loadVersions(serviceId) // the save minted a new form version (00080)
    }
  }

  if (services.length === 0) {
    return <p className="page-sub">{error ?? 'No services you can edit.'}</p>
  }
  const c = service ? DEPT_COLOR[service.dept as DeptCode] : null
  const isSys = hasRole('system_admin')
  const earlier = selIdx != null ? fields.slice(0, selIdx).filter((f) => f.key) : []

  const onDropCanvas = (e: React.DragEvent, at: number) => {
    e.preventDefault()
    e.stopPropagation()
    const data = e.dataTransfer.getData('text/plain')
    if (data.startsWith('new:')) addField(data.slice(4) as FormField['type'], at)
    else {
      const from = Number(data)
      if (!Number.isNaN(from) && from !== at) moveField(from, from < at ? at - 1 : at)
    }
  }

  return (
    <>
      <div className="builder-bar">
        <h2>Form builder</h2>
        {service && (
          <span className="scope-badge scope-dept">
            {isSys ? 'System admin' : 'Department admin'} · {service.dept}
          </span>
        )}
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <select className="input" style={{ maxWidth: 280 }} value={serviceId} aria-label="Service"
            onChange={(e) => pick(e.target.value)}>
            {services.map((s) => (
              <option key={s.id} value={s.id}>{s.dept} · {s.code} — {s.name}</option>
            ))}
          </select>
          {c && service && (
            <span className="tile-code" style={{ background: c.soft, color: c.rail }}>{service.code}</span>
          )}
        </span>
        <span className="tool-spacer" />
        {dirty
          ? <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber-ink)' }}>Unsaved changes</span>
          : note && <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>{note}</span>}
        <button className="btn" onClick={() => setPreview((p) => !p)}>
          {preview ? 'Back to builder' : 'Preview form'}
        </button>
        <button className="btn primary" onClick={save} disabled={!dirty}>Save form</button>
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

      {versions.length > 0 && (
        <div className="card" style={{ padding: 12, marginBottom: 12 }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.4px', marginBottom: 8 }}>
            Published form versions
          </div>
          {versions.map((v) => (
            <div className="row" key={v.id} style={{ opacity: v.retired_at ? 0.6 : 1 }}>
              <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>v{v.version}</span>
              <div style={{ flex: 1 }}>
                <div className="row-title" style={{ fontSize: 12.5 }}>
                  {v.retired_at ? 'Retired' : v.status === 'published' ? 'Published' : v.status === 'draft' ? 'Draft' : v.status}
                </div>
                <div className="row-desc">
                  {v.published_at ? `Published ${new Date(v.published_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}` : 'Not yet published'}
                </div>
              </div>
              {v.retired_at
                ? <button className="btn" onClick={() => restoreVersion(v)}>Restore</button>
                : <button className="card-link" style={{ color: 'var(--red)', fontSize: 11.5 }} onClick={() => setImpactVersion(v)}>Retire / Delete</button>}
            </div>
          ))}
        </div>
      )}

      <div className="builder" style={preview ? { gridTemplateColumns: '1fr' } : undefined}>
        {!preview && (
          <aside className="pane" aria-label="Field palette">
            <div className="pane-head">Fields</div>
            <div className="palette">
              {PALETTE.map((g) => (
                <div key={g.group}>
                  <div className="pal-group">{g.group}</div>
                  {g.items.map((it) => (
                    <button
                      key={it.type}
                      className="pal-item"
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', `new:${it.type}`)}
                      onClick={() => addField(it.type)}
                      title={`Add a ${it.label.toLowerCase()} field`}
                    >
                      <span className="pal-ico">{it.ico}</span>{it.label}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </aside>
        )}

        <section className="pane" aria-label="Form canvas">
          <div className="pane-head">
            <span>{preview ? 'Preview — what the requester sees' : 'Canvas — drag to reorder · click a field to edit'}</span>
            <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
              {fields.length} field{fields.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className="canvas-wrap">
            <div className="canvas">
              <div className="canvas-title">{service?.name}</div>
              <div className="canvas-sub">
                {preview ? service?.description : 'Live preview of the requester form · fields wrap by width'}
              </div>
              <div className="fgrid">
                {fields.map((f, i) => {
                  if (preview && f.visible === false) return null
                  const hasShowRule = (f.rules ?? []).some((r) => r.effect === 'show')
                  return (
                    <div
                      key={i}
                      className={[
                        'fb-field',
                        f.width === 'half' ? 'half' : 'full',
                        !preview && selIdx === i ? 'sel' : '',
                        !preview && (f.visible === false || hasShowRule) ? 'is-hidden' : '',
                      ].filter(Boolean).join(' ')}
                      style={preview ? { cursor: 'default' } : undefined}
                      draggable={!preview}
                      onDragStart={(e) => e.dataTransfer.setData('text/plain', String(i))}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onDropCanvas(e, i)}
                      onClick={() => !preview && setSelIdx(i)}
                    >
                      <div className="fb-field-top">
                        {!preview && <span className="fb-grip">⠿</span>}
                        <span className="fb-label">
                          {f.label}{f.required && <span className="req"> *</span>}
                        </span>
                        {!preview && (
                          <span className="chip fb-type" style={{ background: selIdx === i ? 'var(--accent-soft)' : 'var(--surface)', color: selIdx === i ? 'var(--accent)' : 'var(--muted)' }}>
                            {f.type}
                          </span>
                        )}
                        {!preview && f.visible === false && (
                          <span className="chip fb-type" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>hidden</span>
                        )}
                        {!preview && f.visible !== false && hasShowRule && (
                          <span className="chip fb-type" title="Shown by a condition" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>conditional</span>
                        )}
                      </div>
                      <CanvasInput f={f} />
                    </div>
                  )
                })}
                {!preview && (
                  <div
                    className="drop-hint"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => onDropCanvas(e, fields.length)}
                  >
                    Drop a field here — or click one in the palette
                  </div>
                )}
                {preview && fields.length === 0 && (
                  <div className="canvas-sub">This form has no fields yet.</div>
                )}
              </div>
            </div>
          </div>
        </section>

        {!preview && (
          <aside className="pane" aria-label="Field properties">
            <div className="pane-head">Properties</div>
            {!sel || selIdx == null ? (
              <div className="props-empty">Click a field on the canvas to edit its label, key, width, and conditions.</div>
            ) : (
              <div className="props">
                <div className="prop-row">
                  <label className="prop-lbl" htmlFor="p-label">Label</label>
                  <input className="input" id="p-label" value={sel.label}
                    onChange={(e) => patch(selIdx, { label: e.target.value })} />
                </div>
                <div className="prop-row">
                  <label className="prop-lbl" htmlFor="p-key">Field key</label>
                  <input className="input mono" id="p-key" value={sel.key}
                    onChange={(e) => renameKey(selIdx, e.target.value)} />
                  <p className="prop-hint">Renaming updates conditions on other fields automatically.</p>
                </div>
                <div className="prop-row">
                  <label className="prop-lbl" htmlFor="p-type">Type</label>
                  <select className="input" id="p-type" value={sel.type}
                    onChange={(e) => patch(selIdx, { type: e.target.value as FormField['type'] })}>
                    {ALL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
                <div className="prop-row">
                  <span className="prop-lbl">Width</span>
                  <div className="prop-seg" role="group" aria-label="Field width">
                    <button className={sel.width !== 'half' ? 'on' : ''}
                      onClick={() => patch(selIdx, { width: 'full' })}>Full</button>
                    <button className={sel.width === 'half' ? 'on' : ''}
                      onClick={() => patch(selIdx, { width: 'half' })}>Half</button>
                  </div>
                </div>

                <div className="toggle-row">
                  <span style={{ fontSize: 12 }}>Visible</span>
                  <button className={`toggle${sel.visible !== false ? ' on' : ''}`}
                    aria-label={`Visible: ${sel.visible !== false ? 'on' : 'off'}`}
                    onClick={() => patch(selIdx, { visible: sel.visible === false })} />
                </div>
                <div className="toggle-row">
                  <span style={{ fontSize: 12 }}>Required</span>
                  <button className={`toggle${sel.required ? ' on' : ''}`}
                    aria-label={`Required: ${sel.required ? 'on' : 'off'}`}
                    onClick={() => patch(selIdx, { required: !sel.required })} />
                </div>

                {sel.type === 'dropdown' && (
                  <>
                    <div className="prop-sec">Options</div>
                    <div className="opt-chips">
                      {(sel.options ?? []).map((o) => (
                        <span key={o} className="opt-chip">
                          {o}
                          <button className="x" aria-label={`Remove option ${o}`}
                            onClick={() => patch(selIdx, { options: (sel.options ?? []).filter((x) => x !== o) })}>
                            ×
                          </button>
                        </span>
                      ))}
                    </div>
                    <input className="input" style={{ width: '100%', marginTop: 6 }}
                      placeholder="Add option + Enter" value={optDraft}
                      onChange={(e) => setOptDraft(e.target.value)}
                      onKeyDown={(e) => {
                        const v = optDraft.trim()
                        if (e.key === 'Enter' && v && !(sel.options ?? []).includes(v)) {
                          patch(selIdx, { options: [...(sel.options ?? []), v] })
                          setOptDraft('')
                        }
                      }} />
                  </>
                )}

                <div className="prop-sec">Conditions</div>
                {(sel.rules ?? []).map((r, j) => (
                  <div key={j} className="cond">
                    {r.effect === 'show' ? 'Show when' : 'Require when'}
                    <span className="mono">{condText(r)}</span>
                    <button className="x" aria-label="Remove condition"
                      onClick={() => patch(selIdx, { rules: (sel.rules ?? []).filter((_, k) => k !== j) })}>
                      ×
                    </button>
                  </div>
                ))}
                {earlier.length > 0 ? (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 6 }}>
                      <select className="input" value={cond.effect} aria-label="Effect"
                        onChange={(e) => setCond((s) => ({ ...s, effect: e.target.value as FieldRule['effect'] }))}>
                        <option value="show">show</option>
                        <option value="require">require</option>
                      </select>
                      <select className="input" value={cond.op} aria-label="Operator"
                        onChange={(e) => setCond((s) => ({ ...s, op: e.target.value as FieldRule['op'] }))}>
                        {RULE_OPS.map((o) => <option key={o} value={o}>{OP_TEXT[o]} {o}</option>)}
                      </select>
                      <select className="input" value={cond.when} aria-label="Source field"
                        onChange={(e) => setCond((s) => ({ ...s, when: e.target.value }))}>
                        <option value="">earlier field…</option>
                        {earlier.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                      </select>
                      <input className="input" placeholder={cond.op === 'in' ? 'a, b, c' : 'value'}
                        value={cond.value} aria-label="Value"
                        onChange={(e) => setCond((s) => ({ ...s, value: e.target.value }))} />
                    </div>
                    <button className="btn dashed" style={{ width: '100%', justifyContent: 'center', fontSize: 11.5 }}
                      disabled={!cond.when || cond.value.trim() === ''}
                      onClick={() => {
                        const value: FieldRule['value'] = cond.op === 'in'
                          ? cond.value.split(',').map((s) => s.trim()).filter(Boolean)
                          : cond.value.trim()
                        patch(selIdx, {
                          rules: [...(sel.rules ?? []), { when: cond.when, op: cond.op, value, effect: cond.effect }],
                        })
                        setCond((s) => ({ ...s, value: '' }))
                      }}>
                      + Add condition
                    </button>
                  </>
                ) : (
                  <p className="prop-hint">Conditions can reference fields earlier in the form — this is the first field.</p>
                )}

                <div className="prop-sec">Validation</div>
                <p className="prop-hint">
                  {TYPE_HINT[sel.type] ?? 'Server-side validation is enforced against the saved schema.'}
                </p>

                <button className="btn" style={{ width: '100%', justifyContent: 'center', color: 'var(--red)', marginTop: 14 }}
                  onClick={() => removeField(selIdx)}>
                  Remove field
                </button>
              </div>
            )}
          </aside>
        )}
      </div>

      <CostCenterAdmin onError={setError} />
      {error && <p className="error-note">{error}</p>}

      {impactVersion && service && (() => {
        // migrate target: the newest live version other than the one being retired
        const newer = versions.find((v) => !v.retired_at && v.status === 'published' && v.id !== impactVersion.id)
        return (
          <ImpactDialog
            kind="form"
            target={{ id: impactVersion.id, code: `${service.code}-v${impactVersion.version}`, label: `${service.name} form v${impactVersion.version}` }}
            migrationTarget={newer ? { id: newer.id, label: `v${newer.version}` } : null}
            onClose={() => setImpactVersion(null)}
            onDone={(msg) => { setNote(msg); loadVersions(serviceId) }}
          />
        )
      })()}
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
