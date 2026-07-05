import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { DEPT_COLOR, type Service } from '../../lib/types'
import { RequestForm, type FormField } from './RequestForm'
import { SEVERITY_STYLE } from '../admin/Announcements'

interface ServiceWithForm extends Service {
  form_schema: FormField[]
  parent_id: string | null
}

interface Banner {
  id: string
  title: string
  body: string | null
  severity: keyof typeof SEVERITY_STYLE
}

export function Portal() {
  const [services, setServices] = useState<ServiceWithForm[]>([])
  const [selected, setSelected] = useState<ServiceWithForm | null>(null)
  const [banners, setBanners] = useState<Banner[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('feature_flags')
      .select('is_enabled')
      .eq('key', 'announcements')
      .single()
      .then(({ data }) => {
        if (!data?.is_enabled) return
        supabase
          .from('announcements')
          .select('id, title, body, severity, starts_at, ends_at').eq('is_active', true)
          .lte('starts_at', new Date().toISOString())
          .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
          .then(({ data: anns }) => setBanners((anns as Banner[]) ?? []))
      })
  }, [])

  useEffect(() => {
    supabase
      .from('services')
      .select('id, dept, code, name, description, form_schema, parent_id')
      .eq('is_active', true)
      .order('dept')
      .order('name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setServices((data as ServiceWithForm[]) ?? [])
        setLoaded(true)
      })
  }, [])

  if (selected) {
    const effective =
      (selected.form_schema ?? []).length === 0 && selected.parent_id
        ? {
            ...selected,
            form_schema:
              services.find((s) => s.id === selected.parent_id)?.form_schema ?? [],
          }
        : selected
    return <RequestForm service={effective} onDone={() => setSelected(null)} />
  }

  return (
    <>
      {banners.map((b) => {
        const s = SEVERITY_STYLE[b.severity] ?? SEVERITY_STYLE.info
        return (
          <div
            key={b.id}
            style={{
              background: s.bg, color: s.fg, borderRadius: 10,
              padding: '10px 16px', marginBottom: 12, fontSize: 13,
            }}
          >
            <span style={{ fontWeight: 500 }}>{b.title}</span>
            {b.body && <span> — {b.body}</span>}
          </div>
        )
      })}
      <h2 className="page-head">Service portal</h2>
      <p className="page-sub">Browse the catalog and submit a request.</p>
      <div className="svc-grid">
        {services.map((s) => {
          const c = DEPT_COLOR[s.dept]
          return (
            <button
              className="svc-tile"
              key={s.id}
              style={{ borderLeftColor: c.rail, cursor: 'pointer', textAlign: 'left' }}
              onClick={() => setSelected(s)}
            >
              <span className="tile-code" style={{ background: c.soft, color: c.rail }}>
                {s.code}
              </span>
              <div>
                <div className="row-title">{s.name}</div>
                <div className="row-desc">{s.description}</div>
                <div className="row-desc" style={{ marginTop: 4, color: c.rail }}>
                  {c.label}
                </div>
              </div>
            </button>
          )
        })}
      </div>
      {!loaded && !error && <p className="page-sub">Loading catalog…</p>}
      {loaded && services.length === 0 && !error && (
        <p className="page-sub">No services in the catalog yet.</p>
      )}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
