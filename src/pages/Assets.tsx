import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
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
  created_at: string
  purchased_on: string | null
  owner: { display_name: string } | null
}

interface License {
  id: string
  name: string
  vendor: string | null
  seats: number
  expires_on: string | null
  status: 'pending' | 'active' | 'rejected'
  license_assignments: {
    profile_id: string
    assigned_at: string
    profile: { id: string; display_name: string }
  }[]
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

interface AssetEvent {
  event_type: string
  detail: Record<string, string>
  created_at: string
  actor: { display_name: string } | null
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
const DAY = 24 * 3600 * 1000

function expiresSoon(l: License) {
  return l.expires_on && new Date(l.expires_on).getTime() < Date.now() + 90 * DAY
}

/** Searchable person picker — acts on pick, no extra confirm click. */
function PersonPicker({ people, placeholder, onPick }: {
  people: Person[]; placeholder: string; onPick: (p: Person) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const matches = q.trim()
    ? people.filter((p) => `${p.display_name} ${p.upn}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6)
    : []
  return (
    <div style={{ position: 'relative', width: 170 }}>
      <input
        className="input" style={{ padding: '5px 9px', fontSize: 12 }}
        placeholder={placeholder} value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && matches.length > 0 && (
        <div className="card" style={{ position: 'absolute', top: '108%', left: 0, right: 0, zIndex: 6 }}>
          {matches.map((p) => (
            <div
              key={p.id} className="row" style={{ cursor: 'pointer', padding: '7px 10px' }}
              onMouseDown={() => { onPick(p); setQ(''); setOpen(false) }}
            >
              <span style={{ fontSize: 12.5 }}>{p.display_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function Assets({ onOpenRequest }: { onOpenRequest: (id: string) => void }) {
  const { hasRole } = useAuth()
  const [section, setSection] = useState<'hardware' | 'licenses' | 'people'>('hardware')
  const [assets, setAssets] = useState<Asset[]>([])
  const [licenses, setLicenses] = useState<License[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [error, setError] = useState<string | null>(null)
  const canApprove = hasRole('team_lead', 'IT') || hasRole('system_admin')

  const load = useCallback(() => {
    supabase
      .from('assets')
      .select('id, tag, category, model, serial, status, assigned_to, request_id, created_at, purchased_on, owner:profiles!assets_assigned_to_fkey(display_name)')
      .order('tag')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setAssets((data as unknown as Asset[]) ?? [])
      })
    supabase
      .from('licenses')
      .select('id, name, vendor, seats, expires_on, status, license_assignments(profile_id, assigned_at, profile:profiles!license_assignments_profile_id_fkey(id, display_name))')
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
    { id: 'hardware', label: 'Hardware', n: assets.length, color: 'var(--it)', soft: 'var(--it-soft)' },
    { id: 'licenses', label: 'Software & licenses', n: licenses.length, color: 'var(--admin)', soft: 'var(--admin-soft)' },
    { id: 'people', label: 'People 360', n: people.length, color: 'var(--green)', soft: 'var(--green-soft)' },
  ] as const

  return (
    <>
      <h2 className="page-head">IT asset management</h2>
      <p className="page-sub">Hardware, license seats, and who holds what. IT portal only.</p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            className="btn"
            style={{
              display: 'flex', gap: 8, alignItems: 'center',
              background: section === t.id ? t.soft : 'var(--card)',
              borderColor: section === t.id ? t.color : 'var(--line)',
              color: section === t.id ? t.color : 'var(--muted)',
              fontWeight: 500,
            }}
            onClick={() => setSection(t.id)}
          >
            {t.label}
            <span className="chip mono" style={{ background: section === t.id ? 'var(--card)' : 'var(--surface)', color: t.color, fontSize: 10 }}>
              {t.n}
            </span>
          </button>
        ))}
      </div>
      {section === 'hardware' && <Hardware assets={assets} people={people} reload={load} setError={setError} />}
      {section === 'licenses' && (
        <Licenses licenses={licenses} people={people} reload={load} setError={setError} canApprove={canApprove} />
      )}
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
  const [form, setForm] = useState({ tag: '', category: 'laptop', model: '', serial: '' })
  const [expanded, setExpanded] = useState<string | null>(null)
  const [events, setEvents] = useState<Record<string, AssetEvent[]>>({})

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setError(null)
    const { error: e } = await supabase.rpc(fn, args)
    if (e) setError(e.message)
    reload()
  }

  const toggleExpand = async (a: Asset) => {
    if (expanded === a.id) return setExpanded(null)
    setExpanded(a.id)
    if (!events[a.id]) {
      const { data } = await supabase
        .from('asset_events')
        .select('event_type, detail, created_at, actor:profiles!asset_events_actor_id_fkey(display_name)')
        .eq('asset_id', a.id)
        .order('id')
      setEvents((s) => ({ ...s, [a.id]: (data as unknown as AssetEvent[]) ?? [] }))
    }
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

  const eventLine = (e: AssetEvent, ppl: Person[]) => {
    const who = (id?: string) => ppl.find((p) => p.id === id)?.display_name ?? 'someone'
    switch (e.event_type) {
      case 'assigned': return { dot: 'var(--it)', text: `Assignment started — issued to ${who(e.detail.profile_id)}` }
      case 'returned': return { dot: 'var(--green)', text: 'Assignment ended — returned to store' }
      case 'created': return { dot: 'var(--green)', text: 'Registered into store' }
      default: return { dot: 'var(--muted)', text: e.event_type.replace('_', ' ') }
    }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <ImportPanel existing={assets} onDone={reload} />
        <button className="btn" style={{ background: 'var(--it-soft)', borderColor: 'var(--it)', color: 'var(--it)', fontWeight: 500 }} onClick={downloadTemplate}>
          Download template
        </button>
        <button
          className="btn" style={{ background: 'var(--green-soft)', borderColor: 'var(--green)', color: 'var(--green)', fontWeight: 500 }}
          onClick={() => printLabels(assets.filter((a) => a.status !== 'retired'))}
        >
          Print all QR labels
        </button>
      </div>
      <div className="card">
        {assets.map((a) => {
          const s = STATUS_CHIP[a.status]
          const isOpen = expanded === a.id
          return (
            <div key={a.id}>
              <div className="row">
                <button
                  className="btn" style={{ padding: '2px 8px', fontSize: 11 }}
                  onClick={() => toggleExpand(a)} aria-label="History"
                >
                  {isOpen ? '▾' : '▸'}
                </button>
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
                <span className="chip" style={{ background: s.bg, color: s.fg }}>{a.status.replace('_', ' ')}</span>
                {a.status === 'in_stock' && (
                  <PersonPicker
                    people={people} placeholder="Assign to… (type name)"
                    onPick={(p) => rpc('assign_asset', { p_asset: a.id, p_profile: p.id })}
                  />
                )}
                {a.status === 'assigned' && (
                  <button className="btn" style={{ padding: '5px 10px' }} onClick={() => rpc('return_asset', { p_asset: a.id })}>
                    Return
                  </button>
                )}
                <button
                  className="btn mono" style={{ padding: '5px 8px', fontSize: 10.5, background: 'var(--ink)', color: '#fff', borderColor: 'var(--ink)' }}
                  title="Print QR label" onClick={() => printLabels([a])}
                >
                  QR
                </button>
              </div>
              {isOpen && (
                <div style={{ background: 'var(--surface)', padding: '10px 18px 12px 52px' }}>
                  <div style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 12 }}>
                    <span style={{ width: 9, height: 9, borderRadius: '50%', background: 'var(--green)', marginTop: 3 }} />
                    <span style={{ flex: 1 }}>
                      In store since {new Date(a.purchased_on ?? a.created_at).toLocaleDateString()}
                      {a.purchased_on ? ` (purchased ${a.purchased_on})` : ''}
                    </span>
                  </div>
                  {(events[a.id] ?? []).map((e, i) => {
                    const line = eventLine(e, people)
                    return (
                      <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 0', fontSize: 12 }}>
                        <span style={{ width: 9, height: 9, borderRadius: '50%', background: line.dot, marginTop: 3 }} />
                        <span style={{ flex: 1 }}>{line.text}{e.actor ? ` · by ${e.actor.display_name}` : ''}</span>
                        <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                          {new Date(e.created_at).toLocaleString()}
                        </span>
                      </div>
                    )
                  })}
                  {(events[a.id] ?? []).length === 0 && (
                    <div className="row-desc" style={{ paddingLeft: 17 }}>No movements recorded yet.</div>
                  )}
                </div>
              )}
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

function Licenses({ licenses, people, reload, setError, canApprove }: {
  licenses: License[]; people: Person[]; reload: () => void
  setError: (e: string | null) => void; canApprove: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [form, setForm] = useState({ name: '', vendor: '', seats: '5', expires: '' })

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setError(null)
    const { error: e } = await supabase.rpc(fn, args)
    if (e) setError(e.message)
    reload()
  }

  const request = async () => {
    setError(null)
    const { error: e } = await supabase.rpc('request_license', {
      p_name: form.name.trim(), p_vendor: form.vendor.trim(),
      p_seats: Number(form.seats) || 1, p_expires: form.expires || null,
    })
    if (e) setError(e.message)
    else setForm({ name: '', vendor: '', seats: '5', expires: '' })
    reload()
  }

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
        {licenses.map((l) => {
          const used = l.license_assignments.length
          const pct = Math.min(100, (used / l.seats) * 100)
          const red = expiresSoon(l)
          const open = openId === l.id
          return (
            <div className="card" key={l.id} style={{ padding: 16, opacity: l.status === 'rejected' ? 0.55 : 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1 }}>
                  <div className="row-title">{l.name}</div>
                  <div className="row-desc">{l.vendor ?? '—'}</div>
                </div>
                {l.status === 'pending' && (
                  <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>awaiting IT head</span>
                )}
                {l.status === 'rejected' && (
                  <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>rejected</span>
                )}
                {l.expires_on && (
                  <span className="chip mono" style={{
                    background: red ? 'var(--red)' : 'var(--surface)',
                    color: red ? '#fff' : 'var(--muted)', fontSize: 10, fontWeight: red ? 600 : 500,
                  }}>
                    exp {l.expires_on}
                  </span>
                )}
              </div>
              {l.status === 'pending' && canApprove && (
                <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                  <button className="btn primary" style={{ padding: '5px 12px' }} onClick={() => rpc('decide_license', { p_license: l.id, p_approve: true })}>
                    Approve
                  </button>
                  <button className="btn" style={{ padding: '5px 12px' }} onClick={() => rpc('decide_license', { p_license: l.id, p_approve: false })}>
                    Reject
                  </button>
                </div>
              )}
              {l.status === 'active' && (
                <>
                  <div style={{ margin: '10px 0 4px', background: 'var(--surface)', borderRadius: 4, height: 10 }}>
                    <div style={{ width: `${pct}%`, height: 10, borderRadius: 4, background: pct >= 100 ? 'var(--red)' : pct >= 80 ? 'var(--amber)' : 'var(--green)' }} />
                  </div>
                  <div className="row-desc" style={{ marginBottom: 8 }}>{used} of {l.seats} seats used</div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button className="btn" style={{ flex: 1, padding: '5px 10px' }} onClick={() => setOpenId(open ? null : l.id)}>
                      {open ? 'Hide assignees' : `View assignees (${used})`}
                    </button>
                    <PersonPicker
                      people={people.filter((p) => !l.license_assignments.some((la) => la.profile_id === p.id))}
                      placeholder="Assign seat…"
                      onPick={(p) => rpc('assign_license', { p_license: l.id, p_profile: p.id })}
                    />
                  </div>
                  {open && (
                    <div style={{ marginTop: 10 }}>
                      <div style={{ background: 'var(--amber-soft)', color: 'var(--amber)', borderRadius: 8, padding: '8px 10px', fontSize: 11.5, marginBottom: 8 }}>
                        Tracking only — revoking a seat here does not deprovision the license on the
                        vendor's system. Remove it there yourself.
                      </div>
                      {l.license_assignments.map((la) => (
                        <div key={la.profile_id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12.5 }}>
                          <span style={{ flex: 1 }}>{la.profile?.display_name ?? '—'}</span>
                          <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>
                            since {new Date(la.assigned_at).toLocaleDateString()}
                          </span>
                          <button
                            className="btn" style={{ padding: '2px 8px', color: 'var(--red)' }}
                            onClick={() => rpc('revoke_license', { p_license: l.id, p_profile: la.profile_id })}
                          >
                            revoke
                          </button>
                        </div>
                      ))}
                      {used === 0 && <div className="row-desc">No seats assigned.</div>}
                    </div>
                  )}
                </>
              )}
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
          <button className="btn primary" onClick={request} disabled={!form.name.trim()}>Request license</button>
          <span style={{ fontSize: 11, color: 'var(--muted)', width: '100%' }}>
            New licenses require IT department head approval before seats can be assigned.
          </span>
        </div>
      </div>
    </>
  )
}

interface GraphNode {
  id: string
  type: 'asset' | 'license' | 'request'
  code: string
  label: string
  color: string
  soft: string
  data: Asset | License | Req
}

function People({ people, assets, licenses, onOpenRequest }: {
  people: Person[]; assets: Asset[]; licenses: License[]; onOpenRequest: (id: string) => void
}) {
  const [selected, setSelected] = useState<Person | null>(null)
  const [requests, setRequests] = useState<Req[]>([])
  const [node, setNode] = useState<GraphNode | null>(null)

  useEffect(() => {
    setNode(null)
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
  const nodes: GraphNode[] = [
    ...myAssets.map((a): GraphNode => ({
      id: a.id, type: 'asset', code: CAT_CODE[a.category] ?? 'AS', label: a.tag,
      color: 'var(--it)', soft: 'var(--it-soft)', data: a,
    })),
    ...myLicenses.map((l): GraphNode => ({
      id: l.id, type: 'license', code: 'SW', label: l.name,
      color: 'var(--admin)', soft: 'var(--admin-soft)', data: l,
    })),
    ...requests.slice(0, 6).map((r): GraphNode => ({
      id: r.id, type: 'request', code: 'RQ', label: r.ref,
      color: 'var(--accent)', soft: 'var(--accent-soft)', data: r,
    })),
  ]

  const W = 400
  const H = 380
  const cx = W / 2
  const cy = H / 2 - 6
  const R = Math.min(140, 90 + nodes.length * 4)
  const pos = (i: number) => {
    const angle = (i / Math.max(1, nodes.length)) * 2 * Math.PI - Math.PI / 2
    return { x: cx + R * Math.cos(angle), y: cy + R * Math.sin(angle) }
  }
  const initials = selected.display_name.split(' ').map((x) => x[0]).slice(0, 2).join('')

  return (
    <>
      <button className="btn" style={{ marginBottom: 12 }} onClick={() => setSelected(null)}>← All people</button>
      <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="card" style={{ flex: '1.2 1 380px', padding: 10 }}>
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%' }} role="img" aria-label={`Relationship map for ${selected.display_name}`}>
            {nodes.map((n, i) => {
              const p = pos(i)
              return <line key={`e${n.id}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke={n.color} strokeWidth="1.2" opacity="0.45" />
            })}
            <circle cx={cx} cy={cy} r="34" fill="var(--ink)" />
            <circle cx={cx} cy={cy} r="38" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeDasharray="4 4" />
            <text x={cx} y={cy + 5} textAnchor="middle" fill="#fff" fontSize="15" fontWeight="600" fontFamily="Space Grotesk">{initials}</text>
            <text x={cx} y={cy + 58} textAnchor="middle" fill="var(--ink)" fontSize="11.5" fontWeight="600" fontFamily="Inter">{selected.display_name}</text>
            {nodes.map((n, i) => {
              const p = pos(i)
              const active = node?.id === n.id
              return (
                <g key={n.id} style={{ cursor: 'pointer' }} onClick={() => setNode(n)}>
                  <circle cx={p.x} cy={p.y} r="17" fill={active ? n.color : 'var(--card)'} stroke={n.color} strokeWidth={active ? 2 : 1.4} />
                  <text x={p.x} y={p.y + 3.5} textAnchor="middle" fontSize="9.5" fontWeight="600" fontFamily="JetBrains Mono" fill={active ? '#fff' : n.color}>{n.code}</text>
                  <text x={p.x} y={p.y + 30} textAnchor="middle" fontSize="8.5" fill="var(--muted)" fontFamily="Inter">
                    {n.label.length > 16 ? n.label.slice(0, 15) + '…' : n.label}
                  </text>
                </g>
              )
            })}
          </svg>
          <div style={{ display: 'flex', gap: 6, justifyContent: 'center', paddingBottom: 6 }}>
            <span className="chip" style={{ background: 'var(--it-soft)', color: 'var(--it)' }}>hardware · {myAssets.length}</span>
            <span className="chip" style={{ background: 'var(--admin-soft)', color: 'var(--admin)' }}>licenses · {myLicenses.length}</span>
            <span className="chip" style={{ background: 'var(--accent-soft)', color: 'var(--accent)' }}>requests · {requests.length}</span>
          </div>
        </div>

        <div className="card" style={{ flex: '1 1 300px', padding: 18 }}>
          {!node && (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>Object details</div>
              <div className="row-title" style={{ marginBottom: 2 }}>{selected.display_name}</div>
              <div className="row-desc mono" style={{ fontSize: 11, marginBottom: 14 }}>{selected.upn}</div>
              <Detail label="Hardware" value={`${myAssets.length} device${myAssets.length === 1 ? '' : 's'}`} />
              <Detail label="License seats" value={String(myLicenses.length)} />
              <Detail label="IT requests" value={String(requests.length)} />
              <p style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 14 }}>
                Click a node on the map to inspect it.
              </p>
            </>
          )}
          {node?.type === 'asset' && (() => { const a = node.data as Asset; return (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>Object details — hardware</div>
              <div className="row-title" style={{ marginBottom: 10 }}>{a.model ?? a.category}</div>
              <Detail label="Asset tag" value={a.tag} mono />
              <Detail label="Serial number" value={a.serial ?? '—'} mono />
              <Detail label="Status" value={a.status.replace('_', ' ')} chip={STATUS_CHIP[a.status]} />
              <Detail label="In store since" value={new Date(a.purchased_on ?? a.created_at).toLocaleDateString()} />
            </>
          )})()}
          {node?.type === 'license' && (() => { const l = node.data as License; return (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>Object details — license</div>
              <div className="row-title" style={{ marginBottom: 10 }}>{l.name}</div>
              <Detail label="Vendor" value={l.vendor ?? '—'} />
              <Detail label="Seats" value={`${l.license_assignments.length} of ${l.seats} used`} />
              <Detail label="Expires" value={l.expires_on ?? 'no expiry'} chip={expiresSoon(l) ? { bg: 'var(--red)', fg: '#fff' } : undefined} />
              <Detail
                label="Assigned since"
                value={new Date(l.license_assignments.find((la) => la.profile_id === selected.id)?.assigned_at ?? '').toLocaleDateString()}
              />
            </>
          )})()}
          {node?.type === 'request' && (() => { const r = node.data as Req; return (
            <>
              <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 10 }}>Object details — request</div>
              <div className="row-title" style={{ marginBottom: 10 }}>{r.title}</div>
              <Detail label="Reference" value={r.ref} mono />
              <Detail label="Status" value={r.status.replace('_', ' ')} />
              <Detail label="Submitted" value={new Date(r.created_at).toLocaleDateString()} />
              <div style={{ marginTop: 12 }}>
                <button className="btn primary" onClick={() => onOpenRequest(r.id)}>Open request</button>
              </div>
            </>
          )})()}
        </div>
      </div>
    </>
  )
}

function Detail({ label, value, mono, chip }: {
  label: string; value: string; mono?: boolean; chip?: { bg: string; fg: string }
}) {
  return (
    <div style={{ display: 'flex', gap: 10, padding: '5px 0', fontSize: 13, alignItems: 'center' }}>
      <span style={{ color: 'var(--muted)', width: 120, flexShrink: 0, fontSize: 12 }}>{label}</span>
      {chip ? (
        <span className="chip" style={{ background: chip.bg, color: chip.fg }}>{value}</span>
      ) : (
        <span className={mono ? 'mono' : undefined} style={{ color: 'var(--ink)', fontSize: mono ? 12 : 13 }}>{value}</span>
      )}
    </div>
  )
}
