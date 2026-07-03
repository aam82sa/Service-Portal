import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEPT_COLOR, type Service } from '../lib/types'

export function Portal() {
  const [services, setServices] = useState<Service[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('services')
      .select('id, dept, code, name, description')
      .eq('is_active', true)
      .order('dept')
      .order('name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setServices((data as Service[]) ?? [])
        setLoaded(true)
      })
  }, [])

  return (
    <>
      <h2 className="page-head">Service portal</h2>
      <p className="page-sub">Browse the catalog and submit a request.</p>
      <div className="svc-grid">
        {services.map((s) => {
          const c = DEPT_COLOR[s.dept]
          return (
            <div className="svc-tile" key={s.id} style={{ borderLeftColor: c.rail }}>
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
            </div>
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
