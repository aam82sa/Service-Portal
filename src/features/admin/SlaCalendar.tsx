import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

interface DayRow {
  dow: number
  opens: string
  closes: string
  is_workday: boolean
}

interface Holiday {
  day: string
  name: string
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

export function SlaCalendar() {
  const [days, setDays] = useState<DayRow[]>([])
  const [holidays, setHolidays] = useState<Holiday[]>([])
  const [newDay, setNewDay] = useState('')
  const [newName, setNewName] = useState('')
  const [dirty, setDirty] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = () => {
    supabase.from('business_hours').select('*').order('dow')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setDays((data as DayRow[]) ?? [])
      })
    supabase.from('holidays').select('*').order('day')
      .then(({ data }) => setHolidays((data as Holiday[]) ?? []))
  }
  useEffect(load, [])

  const patch = (dow: number, p: Partial<DayRow>) => {
    setDays((ds) => ds.map((d) => (d.dow === dow ? { ...d, ...p } : d)))
    setDirty(true)
    setNote(null)
  }

  const save = async () => {
    setError(null)
    const results = await Promise.all(
      days.map((d) =>
        supabase
          .from('business_hours')
          .update({ opens: d.opens, closes: d.closes, is_workday: d.is_workday })
          .eq('dow', d.dow)
      )
    )
    const failed = results.find((r) => r.error)
    if (failed?.error) setError(failed.error.message)
    else {
      setDirty(false)
      setNote('Saved — the SLA clock uses these hours')
    }
  }

  const addHoliday = async () => {
    if (!newDay || !newName.trim()) return
    const { error: e } = await supabase.from('holidays').insert({ day: newDay, name: newName.trim() })
    if (e) setError(e.message)
    else {
      setNewDay('')
      setNewName('')
      load()
    }
  }

  const removeHoliday = async (day: string) => {
    const { error: e } = await supabase.from('holidays').delete().eq('day', day)
    if (e) setError(e.message)
    load()
  }

  return (
    <>
      <h2 className="page-head">SLA calendar</h2>
      <p className="page-sub">
        Business hours and holidays for SLA math. Saudi work week: Sunday to Thursday.
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div className="card" style={{ flex: 1, minWidth: 320 }}>
          {days.map((d) => (
            <div className="row" key={d.dow} style={{ opacity: d.is_workday ? 1 : 0.55 }}>
              <span style={{ width: 90, fontSize: 13, color: 'var(--ink)' }}>{DAY_NAMES[d.dow]}</span>
              <button
                className={`toggle${d.is_workday ? ' on' : ''}`}
                onClick={() => patch(d.dow, { is_workday: !d.is_workday })}
                aria-label={`${DAY_NAMES[d.dow]} workday`}
              />
              <input
                className="input" type="time" style={{ width: 110 }}
                value={d.opens.slice(0, 5)} disabled={!d.is_workday}
                onChange={(e) => patch(d.dow, { opens: e.target.value })}
              />
              <span style={{ color: 'var(--muted)', fontSize: 12 }}>to</span>
              <input
                className="input" type="time" style={{ width: 110 }}
                value={d.closes.slice(0, 5)} disabled={!d.is_workday}
                onChange={(e) => patch(d.dow, { closes: e.target.value })}
              />
            </div>
          ))}
          <div className="row">
            <button className="btn primary" onClick={save} disabled={!dirty}>Save hours</button>
            <span style={{ fontSize: 11.5, color: 'var(--green)', marginLeft: 'auto' }}>{note}</span>
          </div>
        </div>

        <div className="card" style={{ flex: 1, minWidth: 300 }}>
          <div className="row" style={{ fontSize: 11.5, color: 'var(--muted)' }}>Holidays (SLA clock paused)</div>
          {holidays.map((h) => (
            <div className="row" key={h.day}>
              <span className="mono" style={{ fontSize: 12, width: 100 }}>{h.day}</span>
              <span style={{ flex: 1, fontSize: 13 }}>{h.name}</span>
              <button
                className="btn"
                style={{ padding: '2px 8px', color: 'var(--red)' }}
                onClick={() => removeHoliday(h.day)}
                aria-label={`Remove ${h.name}`}
              >
                ×
              </button>
            </div>
          ))}
          {holidays.length === 0 && <div className="row row-desc">No holidays configured.</div>}
          <div className="row">
            <input className="input" type="date" style={{ width: 150 }} value={newDay} onChange={(e) => setNewDay(e.target.value)} />
            <input className="input" style={{ flex: 1 }} placeholder="Eid al-Fitr" value={newName} onChange={(e) => setNewName(e.target.value)} />
            <button className="btn" onClick={addHoliday} disabled={!newDay || !newName.trim()}>Add</button>
          </div>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
