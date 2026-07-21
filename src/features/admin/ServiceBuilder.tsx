import { useEffect, useRef, useState, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import { useDepartments, useDeptStyle } from '../../lib/departments'
import type { FormField } from '../catalog/RequestForm'
import { ImpactDialog } from './ImpactDialog'

interface Svc {
  id: string
  dept: DeptCode | null
  dept_id: string | null
  dept_ref: { code: string } | null
  code: string
  name: string
  description: string | null
  parent_id: string | null
  requires_approval: boolean
  is_active: boolean
  retired_at: string | null
  sla_response_minutes: number | null
  sla_resolution_minutes: number | null
  form_schema: FormField[]
}

/** the code a service belongs to, resolved from dept_id for dynamic streams */
const svcCode = (s: Svc): string => s.dept_ref?.code ?? s.dept ?? ''

export function ServiceBuilder() {
  const { hasRole } = useAuth()
  const { active: activeDepts, byCode } = useDepartments()
  const styleForCode = useDeptStyle()
  const [services, setServices] = useState<Svc[]>([])
  const [slaProfiles, setSlaProfiles] = useState<{ id: string; name: string }[]>([])
  const [form, setForm] = useState({
    name: '', description: '', dept: 'IT' as DeptCode,
    parent: '', requiresApproval: false, respH: '4', resoH: '48',
    formSource: 'blank', workflowSource: 'defaults', slaProfile: '',
  })
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'live' | 'retired'>('live')
  const [impactFor, setImpactFor] = useState<Svc | null>(null)
  const [editing, setEditing] = useState<string | null>(null)

  const load = () =>
    supabase
      .from('services')
      .select('id, dept, dept_id, code, name, description, parent_id, requires_approval, is_active, retired_at, sla_response_minutes, sla_resolution_minutes, form_schema, dept_ref:departments!services_dept_id_fk(code)')
      .order('name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setServices((data as unknown as Svc[]) ?? [])
      })
  useEffect(() => {
    load()
    supabase.from('sla_profiles').select('id, name').order('name')
      .then(({ data }) => setSlaProfiles((data as { id: string; name: string }[]) ?? []))
  }, [])

  const editable = (d: DeptCode) => hasRole('system_admin') || hasRole('dept_admin', d)
  const mains = services.filter((s) => !s.parent_id && svcCode(s) === form.dept)
  const isChild = form.parent !== ''

  const resetForm = () => {
    setEditing(null)
    setForm({
      name: '', description: '', dept: form.dept, parent: '',
      requiresApproval: false, respH: '4', resoH: '48',
      formSource: 'blank', workflowSource: 'defaults', slaProfile: '',
    })
  }

  // Edit in place: prefill the builder and turn Create into Save. Names, SLA
  // and the approval flag are plain edits — no impact dialog (they don't break
  // in-flight requests); Retire / Delete is the guarded path for that.
  const startEdit = (s: Svc) => {
    setError(null); setNote(null)
    setEditing(s.id)
    setForm({
      name: s.name, description: s.description ?? '',
      dept: svcCode(s) as DeptCode, parent: s.parent_id ?? '',
      requiresApproval: s.requires_approval,
      respH: s.sla_response_minutes ? String(s.sla_response_minutes / 60) : '4',
      resoH: s.sla_resolution_minutes ? String(s.sla_resolution_minutes / 60) : '48',
      formSource: 'blank', workflowSource: 'defaults', slaProfile: '',
    })
  }

  const duplicate = (s: Svc) => {
    setError(null); setNote(null); setEditing(null)
    setForm({
      name: `${s.name} (copy)`, description: s.description ?? '',
      dept: svcCode(s) as DeptCode, parent: s.parent_id ?? '',
      requiresApproval: s.requires_approval,
      respH: s.sla_response_minutes ? String(s.sla_response_minutes / 60) : '4',
      resoH: s.sla_resolution_minutes ? String(s.sla_resolution_minutes / 60) : '48',
      formSource: (s.form_schema ?? []).length > 0 ? `copy:${s.id}` : 'blank',
      workflowSource: `copy:${s.id}`, slaProfile: '',
    })
  }

  const restore = async (s: Svc) => {

    const { error: e } = await supabase.from('services')
      .update({ retired_at: null, retired_by: null, retire_reason: null, is_active: true }).eq('id', s.id)
    if (e) setError(e.message)
    else setNote(`${s.code} restored to the live catalog.`)
    load()
  }

  const save = async () => {
    setError(null)
    const { error: e } = await supabase.from('services').update({
      name: form.name.trim(),
      description: form.description.trim() || null,
      requires_approval: form.requiresApproval,
      sla_response_minutes: Math.round(Number(form.respH) * 60) || null,
      sla_resolution_minutes: Math.round(Number(form.resoH) * 60) || null,
    }).eq('id', editing!)
    if (e) return setError(e.message)
    setNote('Service updated.')
    resetForm()
    load()
  }

  const create = async () => {
    if (editing) return save()
    setError(null)
    setNote(null)
    let schema: FormField[] = []
    if (form.formSource.startsWith('copy:')) {
      schema = services.find((s) => s.id === form.formSource.slice(5))?.form_schema ?? []
    }
    // built-in codes still populate the enum dept; dynamic streams use dept_id only
    const isBuiltIn = form.dept in DEPT_COLOR
    const { data, error: e } = await supabase
      .from('services')
      .insert({
        name: form.name.trim(),
        description: form.description.trim() || null,
        dept: isBuiltIn ? form.dept : null,
        dept_id: byCode[form.dept]?.id ?? null,
        parent_id: form.parent || null,
        requires_approval: form.requiresApproval,
        sla_profile_id: form.slaProfile || null,
        sla_response_minutes: Math.round(Number(form.respH) * 60) || null,
        sla_resolution_minutes: Math.round(Number(form.resoH) * 60) || null,
        form_schema: schema,
      })
      .select('id, code')
      .single()
    if (e) return setError(e.message)
    const newId = (data as { id: string }).id
    const newCode = (data as { code: string }).code
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
    setNote(`Service created with reference ${newCode} — refine it in the Form builder and Workflow designer`)
    setForm({ ...form, name: '', description: '', parent: '' })
    load()
  }

  const toggleActive = async (s: Svc) => {
    const { error: e } = await supabase.from('services').update({ is_active: !s.is_active }).eq('id', s.id)
    if (e) setError(e.message)
    load()
  }

  const withPublished = services.filter(() => true) // workflow copy options come from all services
  const valid = form.name.trim().length > 1

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
          <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)', alignSelf: 'center' }}>
            ref auto-generated
          </span>
          <select className="input" style={{ width: 140 }} value={form.slaProfile} onChange={(e) => setForm({ ...form, slaProfile: e.target.value })}>
            <option value="">SLA: per-service hours</option>
            {slaProfiles.map((p) => <option key={p.id} value={p.id}>SLA: {p.name}</option>)}
          </select>
          <select className="input" style={{ width: 160 }} value={form.dept} onChange={(e) => setForm({ ...form, dept: e.target.value as DeptCode, parent: '' })}>
            {activeDepts.map((d) => <option key={d.id} value={d.code}>{d.name}</option>)}
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
          <button className="btn primary" onClick={create} disabled={!valid || !editable(form.dept)}>
            {editing ? 'Save changes' : 'Create service'}
          </button>
          {editing && <button className="btn" onClick={resetForm}>Cancel edit</button>}
          <span style={{ fontSize: 11.5, color: note ? 'var(--green)' : 'var(--muted)' }}>
            {note ?? 'Code is the 2–3 letter tile label, e.g. HW'}
          </span>
        </div>
      </div>

      <div className="seg" role="tablist" aria-label="Service list" style={{ marginBottom: 10 }}>
        <button role="tab" aria-selected={tab === 'live'} className={tab === 'live' ? 'active' : ''} onClick={() => setTab('live')}>Live</button>
        <button role="tab" aria-selected={tab === 'retired'} className={tab === 'retired' ? 'active' : ''} onClick={() => setTab('retired')}>
          Retired
        </button>
      </div>

      <div className="card">
        {(() => {
          const inTab = (s: Svc) => (tab === 'retired' ? s.retired_at !== null : s.retired_at === null)
          const mainsInTab = services.filter((s) => !s.parent_id && inTab(s))
          if (mainsInTab.length === 0) {
            return <div className="row"><span className="row-desc">{tab === 'retired' ? 'No retired services.' : 'No services yet.'}</span></div>
          }
          return mainsInTab.map((main) => {
            const c = styleForCode(svcCode(main))
            const children = services.filter((s) => s.parent_id === main.id && inTab(s))
            const canEdit = editable(svcCode(main))
            return (
              <div key={main.id}>
                <div className="row" style={{ opacity: main.is_active ? 1 : 0.5 }}>
                  <span className="tile-code" style={{ background: c.soft, color: c.rail }}>{main.code}</span>
                  <div style={{ flex: 1 }}>
                    <div className="row-title">{main.name}</div>
                    <div className="row-desc">{main.description} · {c.label}</div>
                  </div>
                  {main.requires_approval && <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>DoA</span>}
                  {canEdit && tab === 'live' && (
                    <>
                      <button className={`toggle${main.is_active ? ' on' : ''}`} onClick={() => toggleActive(main)} aria-label="active" />
                      <ActionMenu>
                        <button className="menu-item" onClick={() => startEdit(main)}>Edit</button>
                        <button className="menu-item" onClick={() => duplicate(main)}>Duplicate</button>
                        <button className="menu-item danger" onClick={() => setImpactFor(main)}>Retire / Delete…</button>
                      </ActionMenu>
                    </>
                  )}
                  {canEdit && tab === 'retired' && (
                    <button className="btn" onClick={() => restore(main)}>Restore</button>
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
                    {editable(svcCode(ch)) && tab === 'live' && (
                      <>
                        <button className={`toggle${ch.is_active ? ' on' : ''}`} onClick={() => toggleActive(ch)} aria-label="active" />
                        <ActionMenu>
                          <button className="menu-item" onClick={() => startEdit(ch)}>Edit</button>
                          <button className="menu-item" onClick={() => duplicate(ch)}>Duplicate</button>
                          <button className="menu-item danger" onClick={() => setImpactFor(ch)}>Retire / Delete…</button>
                        </ActionMenu>
                      </>
                    )}
                    {editable(svcCode(ch)) && tab === 'retired' && (
                      <button className="btn" onClick={() => restore(ch)}>Restore</button>
                    )}
                  </div>
                ))}
              </div>
            )
          })
        })()}
      </div>
      {error && <p className="error-note">{error}</p>}

      {impactFor && (
        <ImpactDialog
          kind="service"
          target={{ id: impactFor.id, code: impactFor.code, label: impactFor.name }}
          onClose={() => setImpactFor(null)}
          onDone={(msg) => { setNote(msg); load() }}
        />
      )}
    </>
  )
}

/** ⋮ overflow menu with click-away, mirroring the RequestRow pattern. */
function ActionMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])
  return (
    <span ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <button className="overflow" aria-label="Service actions" aria-expanded={open} onClick={() => setOpen((o) => !o)}>⋮</button>
      {open && (
        <div className="menu-pop" onClick={(e) => { if ((e.target as HTMLElement).closest('.menu-item')) setOpen(false) }}>
          {children}
        </div>
      )}
    </span>
  )
}
