import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import type { FormField } from '../catalog/RequestForm'

interface Svc {
  id: string
  dept: DeptCode
  code: string
  name: string
  description: string | null
  parent_id: string | null
  requires_approval: boolean
  is_active: boolean
  sla_response_minutes: number | null
  sla_resolution_minutes: number | null
  form_schema: FormField[]
}

const PORTALS: DeptCode[] = ['IT', 'ADMIN']

export function ServiceBuilder() {
  const { hasRole } = useAuth()
  const [services, setServices] = useState<Svc[]>([])
  const [form, setForm] = useState({
    name: '', code: '', description: '', dept: 'IT' as DeptCode,
    parent: '', requiresApproval: false, respH: '4', resoH: '48',
    formSource: 'blank', workflowSource: 'defaults',
  })
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    supabase
      .from('services')
      .select('id, dept, code, name, description, parent_id, requires_approval, is_active, sla_response_minutes, sla_resolution_minutes, form_schema')
      .order('dept').order('name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setServices((data as Svc[]) ?? [])
      })
  useEffect(() => { load() }, [])

  const editable = (d: DeptCode) => hasRole('system_admin') || hasRole('dept_admin', d)
  const mains = services.filter((s) => !s.parent_id && s.dept === form.dept)
  const isChild = form.parent !== ''

  const create = async () => {
    setError(null)
    setNote(null)
    let schema: FormField[] = []
    if (form.formSource.startsWith('copy:')) {
      schema = services.find((s) => s.id === form.formSource.slice(5))?.form_schema ?? []
    }
    const { data, error: e } = await supabase
      .from('services')
      .insert({
        name: form.name.trim(),
        code: form.code.trim().toUpperCase(),
        description: form.description.trim() || null,
        dept: form.dept,
        parent_id: form.parent || null,
        requires_approval: form.requiresApproval,
        sla_response_minutes: Math.round(Number(form.respH) * 60) || null,
        sla_resolution_minutes: Math.round(Number(form.resoH) * 60) || null,
        form_schema: schema,
      })
      .select('id')
      .single()
    if (e) return setError(e.message)
    const newId = (data as { id: string }).id
    if (form.workflowSource.startsWith('copy:')) {
      const src = form.workflowSource.slice(5)
      const { data: wf } = await supabase
        .from('workflow_definitions')
        .select('graph').eq('service_id', src).eq('status', 'published')
        .order('version', { ascending: false }).limit(1)
      if (wf && wf.length > 0) {
        const { error: we } = await supabase.rpc('publish_workflow', { p_service: newId, p_graph: wf[0].graph })
        if (we) setError(`Service created, but workflow copy failed: ${we.message}`)
      }
    }
    setNote(`Service created — refine it in the Form builder and Workflow designer`)
    setForm({ ...form, name: '', code: '', description: '', parent: '' })
    load()
  }

  const toggleActive = async (s: Svc) => {
    const { error: e } = await supabase.from('services').update({ is_active: !s.is_active }).eq('id', s.id)
    if (e) setError(e.message)
    load()
  }

  const withPublished = services.filter((s) => true) // workflow copy options come from all services
  const valid = form.name.trim().length > 1 && /^[A-Za-z]{2,3}$/.test(form.code.trim())

  return (
    <>
      <h2 className="page-head">Service builder</h2>
      <p className="page-sub">
        Create services under the IT or Administration portal. Children inherit their parent's
        form and workflow until overridden.
      </p>

      <div className="card" style={{ padding: 18, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
          <input className="input" style={{ flex: 2, minWidth: 180 }} placeholder="Service name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input mono" style={{ width: 80 }} placeholder="Code" maxLength={3} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} />
          <select className="input" style={{ width: 150 }} value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value as DeptCode, parent: '' })}>
            {PORTALS.map((d) => <option key={d} value={d}>{DEPT_COLOR[d].label}</option>)}
          </select>
          <select className="input" style={{ width: 200 }} value={form.parent} onChange={(e) => setForm({ ...form, parent: e.target.value })}>
            <option value="">Main service (no parent)</option>
            {mains.map((m) => <option key={m.id} value={m.id}>Child of {m.code} — {m.name}</option>)}
          </select>
        </div>
        <input className="input" style={{ marginBottom: 10 }} placeholder="Description" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>SLA response</span>
          <input className="input" type="number" style={{ width: 70 }} value={form.respH} onChange={(e) => setForm({ ...form, respH: e.target.value })} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>h · resolution</span>
          <input className="input" type="number" style={{ width: 70 }} value={form.resoH} onChange={(e) => setForm({ ...form, resoH: e.target.value })} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>h</span>
          <span style={{ fontSize: 12, color: 'var(--muted)', marginLeft: 14 }}>Requires DoA approval</span>
          <button className={`toggle${form.requiresApproval ? ' on' : ''}`} onClick={() => setForm({ ...form, requiresApproval: !form.requiresApproval })} aria-label="requires approval" />
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          <select className="input" style={{ flex: 1, minWidth: 200 }} value={form.formSource} onChange={(e) => setForm({ ...form, formSource: e.target.value })}>
            <option value="blank">{isChild ? 'Form: inherit from parent' : 'Form: start blank'}</option>
            {services.filter((s) => (s.form_schema ?? []).length > 0).map((s) => (
              <option key={s.id} value={`copy:${s.id}`}>Form: copy from {s.code} — {s.name}</option>
            ))}
          </select>
          <select className="input" style={{ flex: 1, minWidth: 200 }} value={form.workflowSource} onChange={(e) => setForm({ ...form, workflowSource: e.target.value })}>
            <option value="defaults">{isChild ? 'Workflow: inherit from parent' : 'Workflow: platform defaults'}</option>
            {withPublished.map((s) => (
              <option key={s.id} value={`copy:${s.id}`}>Workflow: copy from {s.code} — {s.name}</option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button className="btn primary" onClick={create} disabled={!valid || !editable(form.dept)}>Create service</button>
          <span style={{ fontSize: 11.5, color: note ? 'var(--green)' : 'var(--muted)' }}>
            {note ?? 'Code is the 2–3 letter tile label, e.g. HW'}
          </span>
        </div>
      </div>

      <div className="card">
        {services.filter((s) => !s.parent_id).map((main) => {
          const c = DEPT_COLOR[main.dept]
          const children = services.filter((s) => s.parent_id === main.id)
          return (
            <div key={main.id}>
              <div className="row" style={{ opacity: main.is_active ? 1 : 0.5 }}>
                <span className="tile-code" style={{ background: c.soft, color: c.rail }}>{main.code}</span>
                <div style={{ flex: 1 }}>
                  <div className="row-title">{main.name}</div>
                  <div className="row-desc">{main.description} · {c.label}</div>
                </div>
                {main.requires_approval && <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>DoA</span>}
                {editable(main.dept) && (
                  <button className={`toggle${main.is_active ? ' on' : ''}`} onClick={() => toggleActive(main)} aria-label="active" />
                )}
              </div>
              {children.map((ch) => (
                <div className="row" key={ch.id} style={{ paddingLeft: 44, opacity: ch.is_active ? 1 : 0.5 }}>
                  <span style={{ color: 'var(--line)' }}>└</span>
                  <span className="tile-code" style={{ background: c.soft, color: c.rail, fontSize: 10 }}>{ch.code}</span>
                  <div style={{ flex: 1 }}>
                    <div className="row-title" style={{ fontSize: 12.5 }}>{ch.name}</div>
                    <div className="row-desc">
                      {(ch.form_schema ?? []).length === 0 ? 'inherits parent form' : 'own form'} ·{' '}
                      {ch.requires_approval ? 'DoA required' : 'no approval'}
                    </div>
                  </div>
                  {editable(ch.dept) && (
                    <button className={`toggle${ch.is_active ? ' on' : ''}`} onClick={() => toggleActive(ch)} aria-label="active" />
                  )}
                </div>
              ))}
            </div>
          )
        })}
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
