import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'

interface Announcement {
  id: string
  title: string
  body: string | null
  severity: 'info' | 'warning' | 'critical'
  starts_at: string
  ends_at: string | null
  is_active: boolean
}

export const SEVERITY_STYLE = {
  info: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  warning: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  critical: { bg: 'var(--red-soft)', fg: 'var(--red)' },
} as const

export function Announcements() {
  const { session } = useAuth()
  const [rows, setRows] = useState<Announcement[]>([])
  const [form, setForm] = useState({ title: '', body: '', severity: 'info' as Announcement['severity'], ends: '' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [flagOn, setFlagOn] = useState<boolean | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    supabase
      .from('announcements')
      .select('*')
      .order('starts_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setRows((data as Announcement[]) ?? [])
      })
    supabase
      .from('feature_flags')
      .select('is_enabled')
      .eq('key', 'announcements')
      .single()
      .then(({ data }) => setFlagOn(data?.is_enabled ?? null))
  }
  useEffect(() => { load() }, [])

  const startEdit = (a: Announcement) => {
    setEditingId(a.id)
    setForm({
      title: a.title,
      body: a.body ?? '',
      severity: a.severity,
      ends: a.ends_at ? a.ends_at.slice(0, 10) : '',
    })
  }

  const add = async () => {
    setError(null)
    const payload = {
      title: form.title.trim(),
      body: form.body.trim() || null,
      severity: form.severity,
      ends_at: form.ends ? new Date(form.ends).toISOString() : null,
    }
    const { error: e } = editingId
      ? await supabase.from('announcements').update(payload).eq('id', editingId)
      : await supabase.from('announcements').insert({ ...payload, created_by: session!.user.id })
    if (e) setError(e.message)
    else {
      setForm({ title: '', body: '', severity: 'info', ends: '' })
      setEditingId(null)
      load()
    }
  }

  const remove = async (id: string) => {
    const { error: e } = await supabase.from('announcements').delete().eq('id', id)
    if (e) setError(e.message)
    load()
  }

  const toggleStatus = async (a: Announcement) => {
    const { error: e } = await supabase
      .from('announcements')
      .update({ is_active: !a.is_active })
      .eq('id', a.id)
    if (e) setError(e.message)
    load()
  }

  const now = Date.now()
  const live = (a: Announcement) =>
    a.is_active &&
    new Date(a.starts_at).getTime() <= now && (!a.ends_at || new Date(a.ends_at).getTime() > now)

  return (
    <>
      <h2 className="page-head">Announcements</h2>
      <p className="page-sub">
        Banners shown on the portal while the announcements function is enabled. Critical
        severity is for outages.
      </p>
      {flagOn === false && (
        <div style={{ background: 'var(--red-soft)', color: 'var(--red)', borderRadius: 10, padding: '10px 16px', marginBottom: 12, fontSize: 12.5 }}>
          The <b>Announcements</b> function is switched OFF — banners will not appear on the
          portal until you enable it under Functions.
        </div>
      )}
      <div className="card">
        {rows.map((a) => {
          const s = SEVERITY_STYLE[a.severity]
          return (
            <div className="row" key={a.id}>
              <span className="chip" style={{ background: s.bg, color: s.fg }}>{a.severity}</span>
              <div style={{ flex: 1 }}>
                <div className="row-title">{a.title}</div>
                {a.body && <div className="row-desc">{a.body}</div>}
              </div>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                {new Date(a.starts_at).toLocaleDateString()} – {a.ends_at ? new Date(a.ends_at).toLocaleDateString() : 'open-ended'}
              </span>
              <span className="chip" style={{ background: live(a) ? 'var(--green-soft)' : 'var(--surface)', color: live(a) ? 'var(--green)' : 'var(--muted)' }}>
                {live(a) ? 'live' : a.is_active ? 'scheduled off-window' : 'switched off'}
              </span>
              <button
                className={`toggle${a.is_active ? ' on' : ''}`}
                onClick={() => toggleStatus(a)}
                aria-label={`announcement active: ${a.is_active}`}
                title="Switch announcement on or off"
              />
              <button className="btn" style={{ padding: '2px 10px' }} onClick={() => startEdit(a)}>Edit</button>
              <button className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }} onClick={() => remove(a.id)} aria-label="Remove announcement">×</button>
            </div>
          )
        })}
        {rows.length === 0 && <div className="row row-desc">No announcements.</div>}
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input className="input" style={{ flex: 2, minWidth: 160 }} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <input className="input" style={{ flex: 3, minWidth: 200 }} placeholder="Details (optional)" value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          <select className="input" style={{ width: 110 }} value={form.severity} onChange={(e) => setForm({ ...form, severity: e.target.value as Announcement['severity'] })}>
            <option value="info">info</option>
            <option value="warning">warning</option>
            <option value="critical">critical</option>
          </select>
          <input className="input" type="date" style={{ width: 140 }} title="End date (optional)" value={form.ends} onChange={(e) => setForm({ ...form, ends: e.target.value })} />
          <button className="btn primary" onClick={add} disabled={!form.title.trim()}>
            {editingId ? 'Save changes' : 'Publish'}
          </button>
          {editingId && (
            <button className="btn" onClick={() => { setEditingId(null); setForm({ title: '', body: '', severity: 'info', ends: '' }) }}>
              Cancel edit
            </button>
          )}
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
