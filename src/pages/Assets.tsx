import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { DEPT_COLOR } from '../lib/types'
import { SlaRing } from './Queue'
import { ImportPanel, downloadTemplate, printLabels } from './AssetImport'

interface Asset {
  id: string
  tag: string
  category: string
  model: string | null
  serial: string | null
  status: 'in_stock' | 'assigned' | 'repair' | 'retired'
  assigned_to: string | null
  request_id: string | null
  owner: { display_name: string } | null
}

interface License {
  id: string
  name: string
  vendor: string | null
  seats: number
  expires_on: string | null
  license_assignments: { profile_id: string; profile: { id: string; display_name: string } }[]
}

interface Person {
  id: string
  display_name: string
  upn: string
}

interface Req {
  id: string
  ref: string
  title: string
  status: string
  created_at: string
  sla_resolution_due: string | null
}

const CAT_CODE: Record<string, string> = {
  laptop: 'LT', monitor: 'MN', phone: 'PH', printer: 'PR', accessory: 'AC',
}
const STATUS_CHIP: Record<Asset['status'], { bg: string; fg: string }> = {
  in_stock: { bg: 'var(--green-soft)', fg: 'var(--green)' },
  assigned: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  repair: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
  retired: { bg: 'var(--surface)', fg: 'var(--muted)' },
}

export function Assets({ onOpenRequest }: { onOpenRequest: (id: string) => void }) {
  const [section, setSection] = useState<'hardware' | 'licenses' | 'people'>('hardware')
  const [assets, setAssets] = useState<Asset[]>([])
  const [licenses, setLicenses] = useState<License[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    supabase
      .from('assets')
      .select('id, tag, category, model, serial, status, assigned_to, request_id, owner:profiles!assets_assigned_to_fkey(display_name)')
      .order('tag')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setAssets((data as unknown as Asset[]) ?? [])
      })
    supabase
      .from('licenses')
      .select('id, name, vendor, seats, expires_on, license_assignments(profile_id, profile:profiles!license_assignments_profile_id_fkey(id, display_name))')
      .order('name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setLicenses((data as unknown as License[]) ?? [])
      })
    supabase
      .from('profiles')
      .select('id, display_name, upn')
      .eq('is_active', true)
      .order('display_name')
      .then(({ data }) => setPeople((data as Person[]) ?? []))
  }, [])
  useEffect(load, [load])

  const tabs = [
    ['hardware', 'Hardware'],
    ['licenses', 'Software & licenses'],
    ['people', 'People (360)'],
  ] as const

  return (
    <>
      <h2 className="page-head">IT asset management</h2>
      <p className="page-sub">Hardware, license seats, and who holds what. IT portal only.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className="btn"
            style={{
              background: section === id ? 'var(--accent-soft)' : undefined,
              borderColor: section === id ? 'var(--accent)' : undefined,
            }}
            onClick={() => setSection(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {section === 'hardware' && <Hardware assets={assets} people={people} reload={load} setError={setError} />}
      {section === 'licenses' && <Licenses licenses={licenses} people={people} reload={load} setError={setError} />}
      {section === 'people' && (
        <People people={people} assets={assets} licenses={licenses} onOpenRequest={onOpenRequest} />
      )}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}

function Hardware({ assets, people, reload, setError }: {
  assets: Asset[]; people: Person[]; reload: () => void; setError: (e: string | null) => void
}) {
  const [assignTo, setAssignTo] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ tag: '', category: 'laptop', model: '', serial: '' })

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setError(null)
    const { error: e } = await supabase.rpc(fn, args)
    if (e) setError(e.message)
    reload()
  }

  const add = async () => {
    setError(null)
    const { error: e } = await supabase.from('assets').insert({
      tag: form.tag.trim().toUpperCase(), category: form.category,
      model: form.model.trim() || null, serial: form.serial.trim() || null,
    })
    if (e) setError(e.message)
    else setForm({ tag: '', category: 'laptop', model: '', serial: '' })
    reload()
  }

  return (
    <>
    <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <ImportPanel existing={assets} onDone={reload} />
      <button className="btn" onClick={downloadTemplate}>Download template</button>
      <button className="btn" onClick={() => printLabels(assets.filter((a) => a.status !== 'retired'))}>
        Print all QR labels
      </button>
    </div>
    <div className="card">
      {assets.map((a) => {
        const s = STATUS_CHIP[a.status]
        return (
          <div className="row" key={a.id}>
            <span className="tile-code" style={{ background: 'var(--it-soft)', color: 'var(--it)', fontSize: 10 }}>
              {CAT_CODE[a.category] ?? 'AS'}
            </span>
            <span className="mono" style={{ fontSize: 11.5, width: 105 }}>{a.tag}</span>
            <div style={{ flex: 1 }}>
              <div className="row-title" style={{ fontSize: 12.5 }}>{a.model ?? a.category}</div>
              <div className="row-desc">
                {a.serial ?? 'no serial'}{a.owner ? ` · held by ${a.owner.display_name}` : ''}
              </div>
            </div>
            {a.request_id && (
              <span className="chip mono" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>
                from request
              </span>
            )}
            <span className="chip" style={{ background: s.bg, color: s.fg }}>{a.status.replace('_', ' ')}</span>
            {a.status === 'in_stock' && (
              <>
                <select
                  className="input" style={{ width: 150, padding: '5px 8px', fontSize: 12 }}
                  value={assignTo[a.id] ?? ''}
                  onChange={(e) => setAssignTo((st) => ({ ...st, [a.id]: e.target.value }))}
                >
                  <option value="">Assign to…</option>
                  {people.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
                <button
                  className="btn primary" style={{ padding: '5px 10px' }}
                  disabled={!assignTo[a.id]}
                  onClick={() => rpc('assign_asset', { p_asset: a.id, p_profile: assignTo[a.id] })}
                >
                  Assign
                </button>
              </>
            )}
            {a.status === 'assigned' && (
              <button className="btn" style={{ padding: '5px 10px' }} onClick={() => rpc('return_asset', { p_asset: a.id })}>
                Return
              </button>
            )}
            <button
              className="btn mono" style={{ padding: '5px 8px', fontSize: 10.5 }}
              title="Print QR label" onClick={() => printLabels([a])}
            >
              QR
            </button>
          </div>
        )
      })}
      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <input className="input mono" style={{ width: 130 }} placeholder="RLC-LT-0006" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
        <select className="input" style={{ width: 110 }} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
          {Object.keys(CAT_CODE).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
        <input className="input" style={{ width: 140 }} placeholder="Serial" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
        <button className="btn" onClick={add} disabled={!form.tag.trim()}>+ Add asset</button>
      </div>
    </div>
    </>
  )
}

function Licenses({ licenses, people, reload, setError }: {
  licenses: License[]; people: Person[]; reload: () => void; setError: (e: string | null) => void
}) {
  const [assignTo, setAssignTo] = useState<Record<string, string>>({})
  const [form, setForm] = useState({ name: '', vendor: '', seats: '5', expires: '' })

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setError(null)
    const { error: e } = await supabase.rpc(fn, args)
    if (e) setError(e.message)
    reload()
  }

  const add = async () => {
    setError(null)
    const { error: e } = await supabase.from('licenses').insert({
      name: form.name.trim(), vendor: form.vendor.trim() || null,
      seats: Number(form.seats) || 1, expires_on: form.expires || null,
    })
    if (e) setError(e.message)
    else setForm({ name: '', vendor: '', seats: '5', expires: '' })
    reload()
  }

  const soon = Date.now() + 60 * 24 * 3600 * 1000

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {licenses.map((l) => {
          const used = l.license_assignments.length
          const pct = Math.min(100, (used / l.seats) * 100)
          const expSoon = l.expires_on && new Date(l.expires_on).getTime() < soon
          return (
            <div className="card" key={l.id} style={{ padding: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="row-title">{l.name}</div>
                  <div className="row-desc">{l.vendor ?? '—'}</div>
                </div>
                {l.expires_on && (
                  <span className="chip mono" style={{ background: expSoon ? 'var(--red-soft)' : 'var(--surface)', color: expSoon ? 'var(--red)' : 'var(--muted)', fontSize: 10 }}>
                    exp {l.expires_on}
                  </span>
                )}
              </div>
              <div style={{ margin: '10px 0 4px', background: 'var(--surface)', borderRadius: 4, height: 10 }}>
                <div style={{ width: `${pct}%`, height: 10, borderRadius: 4, background: pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)' }} />
              </div>
              <div className="row-desc" style={{ marginBottom: 8 }}>{used} of {l.seats} seats used</div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {l.license_assignments.map((la) => (
                  <span key={la.profile_id} className="chip" style={{ background: 'var(--it-soft)', color: 'var(--it)', display: 'inline-flex', gap: 5 }}>
                    {la.profile?.display_name ?? '—'}
                    <span style={{ cursor: 'pointer', color: 'var(--red)' }} onClick={() => rpc('revoke_license', { p_license: l.id, p_profile: la.profile_id })}>×</span>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
                <select
                  className="input" style={{ flex: 1, padding: '5px 8px', fontSize: 12 }}
                  value={assignTo[l.id] ?? ''}
                  onChange={(e) => setAssignTo((s) => ({ ...s, [l.id]: e.target.value }))}
                >
                  <option value="">Assign seat…</option>
                  {people.filter((p) => !l.license_assignments.some((la) => la.profile_id === p.id)).map((p) => (
                    <option key={p.id} value={p.id}>{p.display_name}</option>
                  ))}
                </select>
                <button
                  className="btn primary" style={{ padding: '5px 10px' }} disabled={!assignTo[l.id]}
                  onClick={() => rpc('assign_license', { p_license: l.id, p_profile: assignTo[l.id] })}
                >
                  Assign
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <div className="card" style={{ marginTop: 14 }}>
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <input className="input" style={{ flex: 2, minWidth: 150 }} placeholder="License name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <input className="input" style={{ flex: 1, minWidth: 100 }} placeholder="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
          <input className="input" type="number" style={{ width: 80 }} title="Seats" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
          <input className="input" type="date" style={{ width: 140 }} title="Expiry (optional)" value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
          <button className="btn" onClick={add} disabled={!form.name.trim()}>+ Add license</button>
        </div>
      </div>
    </>
  )
}

function People({ people, assets, licenses, onOpenRequest }: {
  people: Person[]; assets: Asset[]; licenses: License[]; onOpenRequest: (id: string) => void
}) {
  const [selected, setSelected] = useState<Person | null>(null)
  const [requests, setRequests] = useState<Req[]>([])

  useEffect(() => {
    if (!selected) return
    supabase
      .from('requests')
      .select('id, ref, title, status, created_at, sla_resolution_due')
      .eq('requester_id', selected.id)
      .eq('dept', 'IT')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRequests((data as Req[]) ?? []))
  }, [selected])

  if (!selected) {
    return (
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))', gap: 12 }}>
        {people.map((p) => {
          const nAssets = assets.filter((a) => a.assigned_to === p.id).length
          const nSeats = licenses.filter((l) => l.license_assignments.some((la) => la.profile_id === p.id)).length
          return (
            <button key={p.id} className="card" style={{ padding: 14, cursor: 'pointer', textAlign: 'left', display: 'flex', gap: 10, alignItems: 'center' }} onClick={() => setSelected(p)}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: 'var(--it-soft)', color: 'var(--it)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 13, flexShrink: 0 }}>
                {p.display_name.split(' ').map((x) => x[0]).slice(0, 2).join('')}
              </div>
              <div>
                <div className="row-title" style={{ fontSize: 13 }}>{p.display_name}</div>
                <div className="row-desc">{nAssets} assets · {nSeats} licenses</div>
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  const myAssets = assets.filter((a) => a.assigned_to === selected.id)
  const myLicenses = licenses.filter((l) => l.license_assignments.some((la) => la.profile_id === selected.id))
  const c = DEPT_COLOR.IT

  return (
    <>
      <button className="btn" style={{ marginBottom: 12 }} onClick={() => setSelected(null)}>← All people</button>
      <div className="card" style={{ padding: 18, marginBottom: 14, display: 'flex', gap: 14, alignItems: 'center' }}>
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: c.soft, color: c.rail, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 600, fontSize: 17 }}>
          {selected.display_name.split(' ').map((x) => x[0]).slice(0, 2).join('')}
        </div>
        <div>
          <h2 style={{ fontSize: 17 }}>{selected.display_name}</h2>
          <div className="row-desc mono" style={{ fontSize: 11 }}>{selected.upn}</div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 18 }}>
          {[['Assets', myAssets.length, c.rail], ['Licenses', myLicenses.length, 'var(--admin)'], ['IT requests', requests.length, 'var(--accent)']].map(([label, n, color]) => (
            <div key={label as string} style={{ textAlign: 'center' }}>
              <div style={{ fontSize: 22, fontFamily: 'var(--font-head)', color: color as string }}>{n}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{label}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>Hardware</div>
          {myAssets.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0' }}>
              <span className="tile-code" style={{ background: c.soft, color: c.rail, fontSize: 10 }}>{CAT_CODE[a.category] ?? 'AS'}</span>
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500 }}>{a.model ?? a.category}</div>
                <div className="row-desc mono" style={{ fontSize: 10 }}>{a.tag}</div>
              </div>
              {a.status === 'repair' && <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)', marginLeft: 'auto' }}>repair</span>}
            </div>
          ))}
          {myAssets.length === 0 && <div className="row-desc">No hardware assigned.</div>}
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>License seats</div>
          {myLicenses.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--admin)' }} />
              <span style={{ fontSize: 12.5 }}>{l.name}</span>
              <span className="row-desc mono" style={{ fontSize: 10, marginLeft: 'auto' }}>{l.expires_on ? `exp ${l.expires_on}` : ''}</span>
            </div>
          ))}
          {myLicenses.length === 0 && <div className="row-desc">No license seats.</div>}
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>IT requests</div>
          {requests.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '5px 0', cursor: 'pointer' }} onClick={() => onOpenRequest(r.id)}>
              <span className="mono" style={{ fontSize: 11, color: 'var(--accent)' }}>{r.ref}</span>
              <span style={{ fontSize: 12, flex: 1 }}>{r.title}</span>
              <SlaRing createdAt={r.created_at} due={r.sla_resolution_due} />
              <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10 }}>{r.status.replace('_', ' ')}</span>
            </div>
          ))}
          {requests.length === 0 && <div className="row-desc">No IT requests.</div>}
        </div>
      </div>
    </>
  )
}
