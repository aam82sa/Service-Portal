import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import type { DeptCode } from '../../lib/types'
import { DEPT_COLOR } from '../../lib/types'

interface Template {
  id: string
  key: string
  dept: DeptCode | null
  subject: string
  body_html: string
  is_active: boolean
}

const DEPTS: DeptCode[] = ['IT', 'ADMIN', 'LOG']
const PLACEHOLDERS = '{{ref}} {{requester_name}} {{title}} {{service}} {{status}} {{sla_due}} {{amount}} {{rating_link}}'

export function EmailStudio() {
  const [templates, setTemplates] = useState<Template[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ subject: string; body_html: string } | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () =>
    supabase
      .from('notification_templates')
      .select('id, key, dept, subject, body_html, is_active')
      .order('key')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else {
          const rows = (data as Template[]) ?? []
          setTemplates(rows)
          if (!selectedId && rows.length > 0) pick(rows[0])
        }
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const selected = useMemo(
    () => templates.find((t) => t.id === selectedId) ?? null,
    [templates, selectedId]
  )
  const keys = useMemo(() => [...new Set(templates.map((t) => t.key))], [templates])

  function pick(t: Template) {
    setSelectedId(t.id)
    setDraft({ subject: t.subject, body_html: t.body_html })
    setNote(null)
    setError(null)
  }

  const save = async () => {
    if (!selected || !draft) return
    const { error: e } = await supabase
      .from('notification_templates')
      .update({ subject: draft.subject, body_html: draft.body_html })
      .eq('id', selected.id)
    if (e) setError(e.message)
    else {
      setNote('Saved')
      load()
    }
  }

  const toggleActive = async (t: Template) => {
    const { error: e } = await supabase
      .from('notification_templates')
      .update({ is_active: !t.is_active })
      .eq('id', t.id)
    if (e) setError(e.message)
    load()
  }

  const addOverride = async (key: string, dept: DeptCode) => {
    const base = templates.find((t) => t.key === key && t.dept === null)
    if (!base) return
    const { error: e } = await supabase.from('notification_templates').insert({
      key, dept, subject: base.subject, body_html: base.body_html, is_active: true,
    })
    if (e) setError(e.message)
    load()
  }

  return (
    <>
      <h2 className="page-head">Email studio</h2>
      <p className="page-sub">
        What the system replies with, per lifecycle event. Department overrides fall back to
        the platform default. Sending goes live with the Microsoft 365 connection.
      </p>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
        <div className="card" style={{ width: 250, flexShrink: 0 }}>
          {keys.map((key) => {
            const variants = templates.filter((t) => t.key === key)
            const missing = DEPTS.filter((d) => !variants.some((v) => v.dept === d))
            return (
              <div className="row" key={key} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 6 }}>
                <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink)' }}>{key}</span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {variants.map((v) => {
                    const label = v.dept ?? 'default'
                    const active = v.id === selectedId
                    const c = v.dept ? DEPT_COLOR[v.dept] : null
                    return (
                      <button
                        key={v.id}
                        className="chip"
                        onClick={() => pick(v)}
                        style={{
                          cursor: 'pointer',
                          border: active ? '1.5px solid var(--accent)' : '1.5px solid transparent',
                          background: c ? c.soft : 'var(--surface)',
                          color: c ? c.rail : 'var(--muted)',
                          opacity: v.is_active ? 1 : 0.5,
                        }}
                      >
                        {label}
                      </button>
                    )
                  })}
                  {missing.length > 0 && (
                    <select
                      className="chip"
                      style={{ border: '1px dashed var(--line)', background: 'var(--card)', color: 'var(--muted)', cursor: 'pointer' }}
                      value=""
                      onChange={(e) => e.target.value && addOverride(key, e.target.value as DeptCode)}
                    >
                      <option value="">+ override</option>
                      {missing.map((d) => (
                        <option key={d} value={d}>{d}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {selected && draft && (
          <div className="card" style={{ flex: 1, padding: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <span className="mono" style={{ fontSize: 12 }}>{selected.key}</span>
              <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                {selected.dept ? `${selected.dept} override` : 'platform default'}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>Send automatically</span>
              <button
                className={`toggle${selected.is_active ? ' on' : ''}`}
                onClick={() => toggleActive(selected)}
                aria-label="active"
              />
            </div>
            <label className="field-label">Subject</label>
            <input
              className="input mono"
              style={{ fontSize: 12, marginBottom: 10 }}
              value={draft.subject}
              onChange={(e) => setDraft({ ...draft, subject: e.target.value })}
            />
            <label className="field-label">Body (HTML)</label>
            <textarea
              className="input mono"
              rows={9}
              style={{ fontSize: 12, marginBottom: 6 }}
              value={draft.body_html}
              onChange={(e) => setDraft({ ...draft, body_html: e.target.value })}
            />
            <div style={{ fontSize: 10.5, color: 'var(--muted)', marginBottom: 12 }}>
              Placeholders: <span className="mono">{PLACEHOLDERS}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <button className="btn primary" onClick={save}>Save template</button>
              <span style={{ fontSize: 11.5, color: 'var(--green)' }}>{note}</span>
            </div>
          </div>
        )}
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
