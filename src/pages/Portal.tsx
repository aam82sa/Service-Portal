import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEPT_COLOR, type Service } from '../lib/types'
import { RequestForm, type FormField } from './RequestForm'

interface ServiceWithForm extends Service {
  form_schema: FormField[]
}

export function Portal() {
  const [services, setServices] = useState<ServiceWithForm[]>([])
  const [selected, setSelected] = useState<ServiceWithForm | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('services')
      .select('id, dept, code, name, description, form_schema')
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
    return <RequestForm service={selected} onDone={() => setSelected(null)} />
  }

  return (
    <>
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
