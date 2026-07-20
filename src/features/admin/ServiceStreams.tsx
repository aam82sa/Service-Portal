import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { previewDeptCode } from '../../lib/streams'
import type { Department } from '../../lib/types'

/**
 * Service streams (departments) — System-admin console section.
 * List every stream with its auto code, colour, service count and active
 * toggle; create a new stream (name + Arabic name + colour + icon → the code
 * is generated automatically and shown before saving); rename/recolour it and
 * jump to the per-stream builders. Everything reads/writes the departments
 * table via the SECURITY DEFINER RPCs from migration 00076 — no enum, no
 * migration, no deploy.
 */
export function ServiceStreams() {
  const { hasRole } = useAuth()
  const canEdit = hasRole('system_admin')
  const nav = useNavigate()

  const [rows, setRows] = useState<Department[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', name_ar: '', color: '#3E6DD8', icon: '' })

  const load = async () => {
    const { data, error: e } = await supabase
      .from('departments')
      .select('id, code, name, name_ar, color, rail_color, icon, is_active, position')
      .order('position', { nullsFirst: false })
      .order('name')
    if (e) { setError(e.message); return }
    setRows((data as Department[]) ?? [])
    const { data: svc } = await supabase.from('services').select('dept_id')
    const c: Record<string, number> = {}
    for (const s of (svc as { dept_id: string | null }[]) ?? []) {
      if (s.dept_id) c[s.dept_id] = (c[s.dept_id] ?? 0) + 1
    }
    setCounts(c)
  }
  useEffect(() => { void load() }, [])

  const codePreview = useMemo(
    () => previewDeptCode(form.name, rows.map((r) => r.code)),
    [form.name, rows],
  )

  const create = async () => {
    if (!form.name.trim() || busy) return
    setBusy(true); setError(null)
    const { error: e } = await supabase.rpc('create_department', {
      p_name: form.name.trim(), p_name_ar: form.name_ar.trim(), p_color: form.color, p_icon: form.icon.trim(),
    })
    setBusy(false)
    if (e) { setError(e.message); return }
    setForm({ name: '', name_ar: '', color: '#3E6DD8', icon: '' })
    await load()
  }

  const toggleActive = async (d: Department) => {
    setRows((rs) => rs.map((r) => (r.id === d.id ? { ...r, is_active: !r.is_active } : r)))
    const { error: e } = await supabase.rpc('set_department_meta', {
      p_id: d.id, p_name_ar: null, p_color: null, p_icon: null, p_active: !d.is_active,
    })
    if (e) { setError(e.message); await load() }
  }

  const saveEdit = async (d: Department, patch: { name: string; code: string; color: string; name_ar: string }) => {
    setBusy(true); setError(null)
    const { error: re } = await supabase.rpc('rename_department', { p_id: d.id, p_name: patch.name, p_code: patch.code })
    if (!re) {
      await supabase.rpc('set_department_meta', { p_id: d.id, p_name_ar: patch.name_ar, p_color: patch.color, p_icon: null, p_active: null })
    }
    setBusy(false)
    if (re) { setError(re.message); return }
    setEditing(null)
    await load()
  }

  return (
    <>
      <h2 className="page-head">Service streams</h2>
      <p className="page-sub">
        Departments the platform serves. Create a stream and it becomes a first-class
        department — add services, SLAs, workflows, forms, teams, routing and role
        assignments under it exactly like the built-in ones. The code is generated from
        the name and is fixed once the stream has services or requests.
      </p>
      {error && (
        <div style={{ background: 'var(--red-soft)', color: 'var(--red)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12.5 }}>
          {error}
        </div>
      )}

      <div className="card">
        {rows.map((d) => (
          <StreamRow
            key={d.id}
            d={d}
            count={counts[d.id] ?? 0}
            canEdit={canEdit}
            editing={editing === d.id}
            busy={busy}
            onEdit={() => setEditing(d.id)}
            onCancel={() => setEditing(null)}
            onToggle={() => toggleActive(d)}
            onSave={(patch) => saveEdit(d, patch)}
            onOpen={(section) => nav(`/admin/${section}`)}
          />
        ))}
        {rows.length === 0 && <div className="row row-desc">No streams yet.</div>}

        {canEdit && (
          <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder="Stream name (e.g. Facilities)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" style={{ flex: 2, minWidth: 140 }} dir="rtl" placeholder="الاسم بالعربية (optional)" value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
            <input className="input" style={{ width: 90 }} placeholder="icon" title="Icon name (optional)" value={form.icon} onChange={(e) => setForm({ ...form, icon: e.target.value })} />
            <input type="color" aria-label="Stream colour" style={{ width: 38, height: 32, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }} value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} />
            <span className="chip mono" title="Auto-generated code" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
              {form.name.trim() ? codePreview : '—'}
            </span>
            <button className="btn primary" onClick={create} disabled={!form.name.trim() || busy}>Create stream</button>
          </div>
        )}
      </div>
    </>
  )
}

const SHORTCUTS: { section: string; label: string }[] = [
  { section: 'services', label: 'Services' },
  { section: 'sla', label: 'SLA' },
  { section: 'workflows', label: 'Workflow' },
  { section: 'forms', label: 'Form' },
  { section: 'teams', label: 'Teams & routing' },
  { section: 'doa', label: 'DoA' },
]

function StreamRow({
  d, count, canEdit, editing, busy, onEdit, onCancel, onToggle, onSave, onOpen,
}: {
  d: Department
  count: number
  canEdit: boolean
  editing: boolean
  busy: boolean
  onEdit: () => void
  onCancel: () => void
  onToggle: () => void
  onSave: (patch: { name: string; code: string; color: string; name_ar: string }) => void
  onOpen: (section: string) => void
}) {
  const rail = d.rail_color || d.color || 'var(--muted)'
  const [name, setName] = useState(d.name)
  const [code, setCode] = useState(d.code)
  const [color, setColor] = useState(d.color || '#3E6DD8')
  const [nameAr, setNameAr] = useState(d.name_ar ?? '')
  const codeLocked = count > 0

  if (editing) {
    return (
      <div className="row" style={{ flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: color }} />
        <input className="input" style={{ flex: 2, minWidth: 140 }} value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" style={{ flex: 2, minWidth: 120 }} dir="rtl" value={nameAr} onChange={(e) => setNameAr(e.target.value)} placeholder="الاسم بالعربية" />
        <input className="input mono" style={{ width: 90 }} value={code} disabled={codeLocked} title={codeLocked ? 'Code is fixed once the stream has services' : 'Code'} onChange={(e) => setCode(e.target.value.toUpperCase())} />
        <input type="color" aria-label="Colour" style={{ width: 38, height: 32, border: 'none', background: 'none', padding: 0, cursor: 'pointer' }} value={color} onChange={(e) => setColor(e.target.value)} />
        <button className="btn primary" style={{ padding: '2px 10px' }} disabled={busy} onClick={() => onSave({ name, code, color, name_ar: nameAr })}>Save</button>
        <button className="btn" style={{ padding: '2px 10px' }} onClick={onCancel}>Cancel</button>
      </div>
    )
  }

  return (
    <div className="row" style={{ alignItems: 'center' }}>
      <span style={{ width: 4, alignSelf: 'stretch', borderRadius: 2, background: rail }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="row-title">
          {d.name}
          {d.name_ar && <span style={{ color: 'var(--muted)', fontWeight: 400 }}> · {d.name_ar}</span>}
        </div>
        <div className="row-desc" style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {canEdit && SHORTCUTS.map((s) => (
            <button
              key={s.section}
              style={{ fontSize: 11.5, color: 'var(--muted)', background: 'none', border: 'none', padding: 0, cursor: 'pointer', textDecoration: 'underline' }}
              onClick={() => onOpen(s.section)}
            >+ {s.label}</button>
          ))}
        </div>
      </div>
      <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{d.code}</span>
      <span className="mono" style={{ fontSize: 11, color: 'var(--muted)', width: 78, textAlign: 'right' }}>{count} service{count === 1 ? '' : 's'}</span>
      <span className="chip" style={{ background: d.is_active ? 'var(--green-soft)' : 'var(--surface)', color: d.is_active ? 'var(--green)' : 'var(--muted)' }}>
        {d.is_active ? 'active' : 'inactive'}
      </span>
      {canEdit && (
        <>
          <button className={`toggle${d.is_active ? ' on' : ''}`} onClick={onToggle} aria-label={`stream active: ${d.is_active}`} title="Activate or deactivate this stream" />
          <button className="btn" style={{ padding: '2px 10px' }} onClick={onEdit}>Edit</button>
        </>
      )}
    </div>
  )
}
