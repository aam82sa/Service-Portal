import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { ImportPanel, downloadTemplate, printLabels } from './AssetImport'
import { TrackerImportPanel } from './TrackerImport'

/** IT assets — design 5a/5b/6a/6b: category tabs, fleet stats, inventory
 *  table with reassignment history, asset detail drawer, software seat
 *  utilization + renewals, Cloud VMs with Azure credit burn. */

interface Asset {
  id: string
  tag: string
  category: string
  model: string | null
  serial: string | null
  status: 'in_stock' | 'assigned' | 'repair' | 'retired'
  assigned_to: string | null
  assigned_name: string | null
  assigned_at: string | null
  request_id: string | null
  created_at: string
  purchased_on: string | null
  manufacturer: string | null
  vendor: string | null
  po_number: string | null
  cost: number | null
  delivery_date: string | null
  warranty_start: string | null
  warranty_end: string | null
  location: string | null
  owner: { display_name: string } | null
}
interface OwnershipRow {
  asset_id: string
  owner_name: string | null
  assigned_at: string | null
  returned_at: string | null
  profile: { display_name: string } | null
}
interface License {
  id: string
  name: string
  vendor: string | null
  seats: number
  expires_on: string | null
  status: 'pending' | 'active' | 'rejected'
  subscription_status: 'active' | 'expired'
  billing_profile: string | null
  po_number: string | null
  license_assignments: {
    profile_id: string
    assigned_at: string
    profile: { id: string; display_name: string }
  }[]
}
interface Person { id: string; display_name: string; upn: string }
interface CloudRes {
  id: string
  kind: 'server' | 'vm' | 'azure_resource'
  name: string
  os_or_type: string | null
  environment: string | null
  priority: string | null
  status: string | null
  owner_name: string | null
  owner_email: string | null
  location: string | null
  resource_group: string | null
  subscription: string | null
}
interface CreditRow {
  month: string
  starting_credit: number | null
  forecast_charges: number | null
  applied_charges: number | null
  ending_credit: number | null
}
interface Req { id: string; ref: string; title: string; status: string; created_at: string }

type Tab = 'laptops' | 'monitors' | 'peripherals' | 'meetingrooms' | 'software' | 'cloud' | 'people'

const TAB_CATS: Record<string, string[]> = {
  laptops: ['laptop'],
  monitors: ['monitor'],
  peripherals: ['dock', 'keyboard_mouse', 'headset', 'printer', 'accessory', 'phone'],
  meetingrooms: ['meeting_room'],
}
const CAT_CODE: Record<string, string> = {
  laptop: 'LT', monitor: 'MN', phone: 'PH', printer: 'PR', accessory: 'AC',
  dock: 'DS', keyboard_mouse: 'KM', headset: 'HS', meeting_room: 'MR',
}
const DAY = 24 * 3600 * 1000

const STATUS_CHIP = {
  assigned: { bg: 'var(--green-soft)', fg: 'var(--green)', label: 'Assigned' },
  in_stock: { bg: 'var(--it-soft)', fg: 'var(--it)', label: 'In stock' },
  returned: { bg: 'var(--amber-soft)', fg: 'var(--amber)', label: 'Returned' },
  repair: { bg: 'var(--amber-soft)', fg: 'var(--amber)', label: 'In repair' },
  retired: { bg: 'var(--surface)', fg: 'var(--muted)', label: 'Retired' },
} as const

const HEAD_CELL = {
  fontSize: 10, fontWeight: 600, textTransform: 'uppercase',
  letterSpacing: '.4px', color: '#8FA0BE',
} as const
const label10 = { fontSize: 10.5, fontWeight: 600, letterSpacing: '.6px', color: 'var(--muted)', textTransform: 'uppercase' } as const
const mono = (extra: Record<string, unknown> = {}) => ({ fontFamily: 'var(--font-mono)', ...extra })
const monthShort = (d: string) => new Date(d).toLocaleDateString(undefined, { month: 'short', year: '2-digit' })
const mmYY = (d: string | null) => (d ? `${d.slice(5, 7)}/${d.slice(2, 4)}` : '—')
const kFmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)))

function StatCard({ label, value, suffix, color }: { label: string; value: string | number; suffix?: string; color?: string }) {
  return (
    <div className="card" style={{ padding: '12px 16px', borderRadius: 12 }}>
      <div style={label10}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 2 }}>
        <span style={{ fontFamily: 'var(--font-head)', fontWeight: 700, fontSize: 24, color: color ?? 'var(--ink)' }}>{value}</span>
        {suffix && <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--muted)' }}>{suffix}</span>}
      </div>
    </div>
  )
}

function PersonPicker({ people, placeholder, onPick }: {
  people: Person[]; placeholder: string; onPick: (p: Person) => void
}) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const matches = q.trim()
    ? people.filter((p) => `${p.display_name} ${p.upn}`.toLowerCase().includes(q.toLowerCase())).slice(0, 6)
    : []
  return (
    <div style={{ position: 'relative', flex: 1 }}>
      <input
        className="input" style={{ padding: '7px 10px', fontSize: 12 }}
        placeholder={placeholder} value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
      />
      {open && matches.length > 0 && (
        <div className="card" style={{ position: 'absolute', bottom: '108%', left: 0, right: 0, zIndex: 50 }}>
          {matches.map((p) => (
            <div key={p.id} className="row" style={{ cursor: 'pointer', padding: '7px 10px' }}
              onMouseDown={() => { onPick(p); setQ(''); setOpen(false) }}>
              <span style={{ fontSize: 12.5 }}>{p.display_name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const exportCsv = (name: string, headers: string[], rows: (string | number | null)[][]) => {
  const esc = (v: string | number | null) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = name
  a.click()
  URL.revokeObjectURL(a.href)
}

export function Assets({ onOpenRequest, initialSection }: {
  onOpenRequest: (id: string) => void
  initialSection?: 'hardware' | 'licenses' | 'people' | 'cloud'
}) {
  const { hasRole } = useAuth()
  const [tab, setTab] = useState<Tab>(
    initialSection === 'licenses' ? 'software' : initialSection === 'people' ? 'people'
      : initialSection === 'cloud' ? 'cloud' : 'laptops')
  const [assets, setAssets] = useState<Asset[]>([])
  const [ownership, setOwnership] = useState<OwnershipRow[]>([])
  const [licenses, setLicenses] = useState<License[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [cloud, setCloud] = useState<CloudRes[]>([])
  const [credit, setCredit] = useState<CreditRow[]>([])
  const [drawer, setDrawer] = useState<Asset | null>(null)
  const [error, setError] = useState<string | null>(null)
  const canApprove = hasRole('team_lead', 'IT') || hasRole('dept_head', 'IT') || hasRole('system_admin')

  const load = useCallback(() => {
    supabase
      .from('assets')
      .select('id, tag, category, model, serial, status, assigned_to, assigned_name, assigned_at, request_id, created_at, purchased_on, manufacturer, vendor, po_number, cost, delivery_date, warranty_start, warranty_end, location, owner:profiles!assets_assigned_to_fkey(display_name)')
      .order('tag')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setAssets((data as unknown as Asset[]) ?? [])
      })
    supabase
      .from('asset_ownership')
      .select('asset_id, owner_name, assigned_at, returned_at, profile:profiles!asset_ownership_profile_id_fkey(display_name)')
      .order('returned_at', { ascending: false })
      .then(({ data }) => setOwnership((data as unknown as OwnershipRow[]) ?? []))
    supabase
      .from('licenses')
      .select('id, name, vendor, seats, expires_on, status, subscription_status, billing_profile, po_number, license_assignments(profile_id, assigned_at, profile:profiles!license_assignments_profile_id_fkey(id, display_name))')
      .order('name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setLicenses((data as unknown as License[]) ?? [])
      })
    supabase.from('profiles').select('id, display_name, upn').eq('is_active', true).order('display_name')
      .then(({ data }) => setPeople((data as Person[]) ?? []))
    supabase
      .from('cloud_resources')
      .select('id, kind, name, os_or_type, environment, priority, status, owner_name, owner_email, location, resource_group, subscription')
      .order('name')
      .then(({ data }) => setCloud((data as CloudRes[]) ?? []))
    supabase
      .from('azure_credit')
      .select('month, starting_credit, forecast_charges, applied_charges, ending_credit')
      .order('month')
      .then(({ data }) => setCredit((data as CreditRow[]) ?? []))
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(null)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [])

  const histByAsset = useMemo(() => {
    const m = new Map<string, OwnershipRow[]>()
    for (const o of ownership) m.set(o.asset_id, [...(m.get(o.asset_id) ?? []), o])
    return m
  }, [ownership])

  const catAssets = (t: Tab) => assets.filter((a) => (TAB_CATS[t] ?? []).includes(a.category))
  const vms = cloud.filter((c) => c.kind === 'vm')
  const activeSubs = licenses.filter((l) => l.status === 'active' && l.subscription_status === 'active')

  const tabs: { id: Tab; label: string; n: number }[] = [
    { id: 'laptops', label: 'Laptops', n: catAssets('laptops').length },
    { id: 'monitors', label: 'Monitors', n: catAssets('monitors').length },
    { id: 'peripherals', label: 'Peripherals', n: catAssets('peripherals').length },
    { id: 'meetingrooms', label: 'Meeting rooms', n: catAssets('meetingrooms').length },
    { id: 'software', label: 'Software', n: activeSubs.length },
    { id: 'cloud', label: 'Cloud VMs', n: vms.length },
    { id: 'people', label: 'People 360', n: people.length },
  ]

  const isHw = tab in TAB_CATS
  const title = tab === 'software' ? 'Software & licenses' : tab === 'cloud' ? 'Cloud VMs' : tab === 'people' ? 'People 360' : 'IT assets'
  const today = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })
  const subtitle =
    tab === 'software'
      ? `${activeSubs.length} active subscriptions · last updated ${today}`
      : tab === 'cloud'
        ? `Azure Virtual Desktop · synced ${today}`
        : `~${assets.length} items across 5 categories · last updated ${today}`

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <h2 style={{ fontSize: 21 }}>{title}</h2>
          <p className="page-sub" style={{ marginBottom: 0 }}>{subtitle}</p>
        </div>
        {isHw && (
          <button className="btn" onClick={() =>
            exportCsv(`assets-${tab}.csv`,
              ['tag', 'category', 'model', 'serial', 'assigned_to', 'vendor', 'cost', 'warranty_end', 'status'],
              catAssets(tab).map((a) => [a.tag, a.category, a.model, a.serial, a.owner?.display_name ?? a.assigned_name, a.vendor, a.cost, a.warranty_end, a.status]))}>
            Export CSV
          </button>
        )}
        {tab === 'software' && (
          <button className="btn" onClick={() =>
            exportCsv('subscriptions.csv',
              ['name', 'seats', 'used', 'expires', 'status'],
              licenses.map((l) => [l.name, l.seats, l.license_assignments.length, l.expires_on, l.subscription_status]))}>
            Export CSV
          </button>
        )}
        {tab === 'cloud' && (
          <a className="btn" href="https://portal.azure.com" target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>
            Open Azure portal ↗
          </a>
        )}
      </div>

      <div style={{ display: 'flex', gap: 2, borderBottom: '1px solid var(--line)', marginBottom: 14 }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => { setDrawer(null); setTab(t.id) }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '8px 14px', fontSize: 12.5, fontFamily: 'var(--font-body)',
              color: tab === t.id ? 'var(--ink)' : 'var(--muted)',
              fontWeight: tab === t.id ? 600 : 400,
              borderBottom: tab === t.id ? '2.5px solid var(--accent)' : '2.5px solid transparent',
              marginBottom: -1,
            }}
          >
            {t.label}{' '}
            <span style={mono({ fontSize: 10.5, color: tab === t.id ? 'var(--accent)' : 'var(--muted)' })}>{t.n}</span>
          </button>
        ))}
      </div>

      {isHw && (
        <Devices
          tab={tab} assets={catAssets(tab)} allAssets={assets} history={histByAsset}
          people={people} reload={load} setError={setError} onOpen={setDrawer}
        />
      )}
      {tab === 'software' && (
        <Software licenses={licenses} people={people} vms={vms} credit={credit}
          reload={load} setError={setError} canApprove={canApprove} />
      )}
      {tab === 'cloud' && <CloudVms vms={vms} cloud={cloud} credit={credit} />}
      {tab === 'people' && (
        <People people={people} assets={assets} licenses={licenses} onOpenRequest={onOpenRequest} />
      )}

      {drawer && (
        <Drawer
          asset={drawer} history={histByAsset.get(drawer.id) ?? []}
          allAssets={assets} licenses={licenses} people={people}
          onClose={() => setDrawer(null)}
          onChanged={() => { load(); setDrawer(null) }}
          setError={setError}
        />
      )}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}

/* ============================== Devices (5a) ============================== */

function Devices({ tab, assets, allAssets, history, people, reload, setError, onOpen }: {
  tab: Tab
  assets: Asset[]
  allAssets: Asset[]
  history: Map<string, OwnershipRow[]>
  people: Person[]
  reload: () => void
  setError: (e: string | null) => void
  onOpen: (a: Asset) => void
}) {
  const [query, setQuery] = useState('')
  const [os, setOs] = useState<'all' | 'win' | 'mac'>('all')
  const [status, setStatus] = useState('')
  const [vendor, setVendor] = useState('')
  const [page, setPage] = useState(0)
  const [registering, setRegistering] = useState(false)
  const [form, setForm] = useState({ tag: '', category: 'laptop', model: '', serial: '' })
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const PAGE = 25

  useEffect(() => { setPage(0); setSelected(new Set()) }, [tab, query, os, status, vendor])

  const isMac = (a: Asset) => (a.manufacturer ?? '').toLowerCase().includes('apple')
  const effStatus = (a: Asset) =>
    a.status === 'in_stock' && (history.get(a.id) ?? []).length > 0 ? 'returned' : a.status

  const vendors = [...new Set(assets.map((a) => a.vendor).filter(Boolean))] as string[]
  const filtered = assets.filter((a) => {
    if (os !== 'all' && (os === 'mac') !== isMac(a)) return false
    if (status && effStatus(a) !== status) return false
    if (vendor && a.vendor !== vendor) return false
    const q = query.trim().toLowerCase()
    if (!q) return true
    const holder = a.owner?.display_name ?? a.assigned_name ?? ''
    return [a.tag, a.serial ?? '', a.model ?? '', holder].some((s) => s.toLowerCase().includes(q))
  })
  const paged = filtered.slice(page * PAGE, (page + 1) * PAGE)

  const assigned = assets.filter((a) => a.status === 'assigned').length
  const returned = assets.filter((a) => effStatus(a) === 'returned').length
  const inStock = assets.filter((a) => effStatus(a) === 'in_stock').length
  const fleetValue = assets.reduce((s, a) => s + (a.cost ?? 0), 0)

  const toggleOne = (id: string) =>
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  const bulkDelete = async () => {
    const ids = [...selected]
    if (!window.confirm(`Delete ${ids.length} asset${ids.length > 1 ? 's' : ''} permanently? Audit trails and ownership history are removed with them.`)) return
    setError(null)
    for (let i = 0; i < ids.length; i += 100) {
      const { error: e } = await supabase.from('assets').delete().in('id', ids.slice(i, i + 100))
      if (e) { setError(e.message); break }
    }
    setSelected(new Set())
    reload()
  }

  const register = async () => {
    setError(null)
    const { error: e } = await supabase.from('assets').insert({
      tag: form.tag.trim().toUpperCase(), category: form.category,
      model: form.model.trim() || null, serial: form.serial.trim() || null,
    })
    if (e) setError(e.message)
    else { setForm({ tag: '', category: 'laptop', model: '', serial: '' }); setRegistering(false) }
    reload()
  }

  const grid = '26px 76px 1.5fr 1.1fr 100px 80px 84px 110px'
  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selected.has(a.id))
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <StatCard label="Assigned" value={assigned} suffix={`of ${assets.length}`} color="var(--green)" />
        <StatCard label="In stock" value={inStock} suffix="ready to issue" color="var(--it)" />
        <StatCard label="Returned" value={returned} suffix="awaiting re-image" color="var(--amber)" />
        <StatCard label="Fleet value" value={`SAR ${kFmt(fleetValue)}`} suffix="at purchase" />
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12, flexWrap: 'wrap' }}>
        <input
          className="input" style={{ maxWidth: 340 }}
          placeholder="Search tag, serial, or user…"
          value={query} onChange={(e) => setQuery(e.target.value)}
        />
        {tab === 'laptops' && (
          <>
            {([['all', `All ${assets.length}`], ['win', `Windows ${assets.filter((a) => !isMac(a)).length}`], ['mac', `macOS ${assets.filter(isMac).length}`]] as const).map(([k, lbl]) => (
              <button key={k} onClick={() => setOs(k)} style={{
                borderRadius: 99, padding: '5px 13px', fontSize: 11.5, cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontWeight: 500,
                background: os === k ? 'var(--ink)' : 'var(--card)',
                color: os === k ? '#fff' : 'var(--muted)',
                border: os === k ? '1px solid var(--ink)' : '1px solid var(--line)',
              }}>
                {lbl}
              </button>
            ))}
          </>
        )}
        <span style={{ flex: 1 }} />
        <select className="input" style={{ width: 130 }} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">Status: Any</option>
          {Object.entries(STATUS_CHIP).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select className="input" style={{ width: 130 }} value={vendor} onChange={(e) => setVendor(e.target.value)}>
          <option value="">Vendor: Any</option>
          {vendors.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
        <button className="btn primary" onClick={() => setRegistering(!registering)}>+ Register asset</button>
      </div>

      {registering && (
        <div className="card" style={{ marginBottom: 12, padding: '12px 16px', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="input mono" style={{ width: 130 }} placeholder="Tag (LT-00099)" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
          <select className="input" style={{ width: 140 }} value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {Object.keys(CAT_CODE).map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
          </select>
          <input className="input" style={{ flex: 1, minWidth: 140 }} placeholder="Model" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} />
          <input className="input" style={{ width: 150 }} placeholder="Serial" value={form.serial} onChange={(e) => setForm({ ...form, serial: e.target.value })} />
          <button className="btn primary" onClick={register} disabled={!form.tag.trim()}>Save</button>
          <ImportPanel existing={allAssets} onDone={reload} />
          <TrackerImportPanel people={people} onDone={reload} />
          <button className="btn" onClick={downloadTemplate}>CSV template</button>
          <button className="btn" onClick={() => printLabels(assets.filter((a) => a.status !== 'retired'))}>Print QR labels</button>
        </div>
      )}

      {selected.size > 0 && (
        <div style={{ background: '#FBEBEB', border: '1px solid #F0CECE', borderRadius: 10, padding: '8px 14px', display: 'flex', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>
            {selected.size} asset{selected.size > 1 ? 's' : ''} selected
          </span>
          <button className="btn" style={{ fontSize: 12 }} onClick={() => setSelected(new Set())}>Clear</button>
          <button
            onClick={bulkDelete}
            style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
          >
            Delete selected
          </button>
        </div>
      )}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '9px 16px', borderBottom: '1px solid #EDEFF4', alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={allFilteredSelected}
            onChange={() => setSelected(allFilteredSelected ? new Set() : new Set(filtered.map((a) => a.id)))}
            title="Select all filtered"
            style={{ cursor: 'pointer', margin: 0 }}
          />
          {['Tag', 'Device / Serial', 'Assigned to', 'Vendor', 'Cost SAR', 'Warranty', 'Status'].map((h) => (
            <span key={h} style={HEAD_CELL}>{h}</span>
          ))}
        </div>
        {paged.map((a) => {
          const st = STATUS_CHIP[effStatus(a)]
          const holder = a.owner?.display_name ?? a.assigned_name
          const prev = (history.get(a.id) ?? [])[0]
          const wSoon = a.warranty_end && new Date(a.warranty_end).getTime() < Date.now() + 90 * DAY
          return (
            <div
              key={a.id}
              onClick={() => onOpen(a)}
              style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '10px 16px', borderBottom: '1px solid #EDEFF4', alignItems: 'center', cursor: 'pointer', background: selected.has(a.id) ? 'var(--accent-soft)' : undefined }}
            >
              <input
                type="checkbox"
                checked={selected.has(a.id)}
                onClick={(e) => e.stopPropagation()}
                onChange={() => toggleOne(a.id)}
                style={{ cursor: 'pointer', margin: 0 }}
              />
              <span style={mono({ fontSize: 11, color: 'var(--muted)' })}>{a.tag}</span>
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {a.model ?? a.category.replace('_', ' ')}
                </span>
                <span style={mono({ fontSize: 10, color: '#8FA0BE' })}>{a.serial ?? '—'}</span>
              </span>
              <span style={{ minWidth: 0 }}>
                {holder
                  ? <span style={{ fontSize: 12, color: 'var(--text)' }}>{holder}</span>
                  : <span style={{ fontSize: 12, fontStyle: 'italic', color: '#8FA0BE' }}>Unassigned</span>}
                {prev && (
                  <span style={{ display: 'block', fontSize: 10, color: '#8FA0BE' }}>
                    prev. {prev.profile?.display_name ?? prev.owner_name}{prev.returned_at ? ` · returned ${mmYY(prev.returned_at)}` : ''}
                  </span>
                )}
              </span>
              <span style={{ fontSize: 12 }}>{a.vendor ?? '—'}</span>
              <span style={mono({ fontSize: 11 })}>{a.cost != null ? a.cost.toLocaleString() : '—'}</span>
              <span style={mono({ fontSize: 11, color: wSoon ? 'var(--red)' : undefined })}>{mmYY(a.warranty_end)}</span>
              <span><span className="chip" style={{ background: st.bg, color: st.fg }}>{st.label}</span></span>
            </div>
          )
        })}
        {paged.length === 0 && <div className="row row-desc">No assets match.</div>}
        <div style={{ display: 'flex', alignItems: 'center', padding: '9px 16px' }}>
          <span style={mono({ fontSize: 11, color: 'var(--muted)' })}>
            {filtered.length === 0 ? '0' : `${page * PAGE + 1}–${Math.min((page + 1) * PAGE, filtered.length)}`} of {filtered.length}
          </span>
          <span style={{ flex: 1 }} />
          <button className="btn" style={{ fontSize: 11.5 }} disabled={page === 0} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <button className="btn" style={{ fontSize: 11.5, marginLeft: 6 }} disabled={(page + 1) * PAGE >= filtered.length} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      </div>
    </>
  )
}

/* ========================== Asset detail drawer (6a) ========================== */

function Drawer({ asset, history, allAssets, licenses, people, onClose, onChanged, setError }: {
  asset: Asset
  history: OwnershipRow[]
  allAssets: Asset[]
  licenses: License[]
  people: Person[]
  onClose: () => void
  onChanged: () => void
  setError: (e: string | null) => void
}) {
  const [reassigning, setReassigning] = useState(false)
  const [editing, setEditing] = useState(false)
  const [f, setF] = useState({
    tag: asset.tag, category: asset.category, model: asset.model ?? '', serial: asset.serial ?? '',
    manufacturer: asset.manufacturer ?? '', vendor: asset.vendor ?? '', po_number: asset.po_number ?? '',
    cost: asset.cost != null ? String(asset.cost) : '', delivery_date: asset.delivery_date ?? '',
    warranty_start: asset.warranty_start ?? '', warranty_end: asset.warranty_end ?? '',
    location: asset.location ?? '',
  })
  const st = STATUS_CHIP[asset.status === 'in_stock' && history.length ? 'returned' : asset.status]
  const holder = asset.owner?.display_name ?? asset.assigned_name

  const saveEdit = async () => {
    setError(null)
    const { error: e } = await supabase.from('assets').update({
      tag: f.tag.trim().toUpperCase(), category: f.category,
      model: f.model.trim() || null, serial: f.serial.trim() || null,
      manufacturer: f.manufacturer.trim() || null, vendor: f.vendor.trim() || null,
      po_number: f.po_number.trim() || null, cost: f.cost ? Number(f.cost) : null,
      delivery_date: f.delivery_date || null, warranty_start: f.warranty_start || null,
      warranty_end: f.warranty_end || null, location: f.location.trim() || null,
    }).eq('id', asset.id)
    if (e) setError(e.message)
    onChanged()
  }

  const deleteAsset = async () => {
    if (!window.confirm(`Delete ${asset.tag} (${asset.model ?? asset.category}) permanently? The audit trail and ownership history go with it.`)) return
    setError(null)
    const { error: e } = await supabase.from('assets').delete().eq('id', asset.id)
    if (e) setError(e.message)
    onChanged()
  }

  const rpc = async (fn: string, args: Record<string, unknown>) => {
    setError(null)
    const { error: e } = await supabase.rpc(fn, args)
    if (e) setError(e.message)
    onChanged()
  }

  const timeline: { text: string; date: string | null; dot: string; note?: string }[] = []
  if (holder) timeline.push({ text: `Assigned to ${holder}`, date: asset.assigned_at, dot: 'var(--green)', note: 'current' })
  for (const o of history) {
    const name = o.profile?.display_name ?? o.owner_name ?? '—'
    if (o.returned_at) timeline.push({ text: `Returned by ${name}`, date: o.returned_at, dot: 'var(--amber)' })
    timeline.push({ text: `Assigned to ${name}`, date: o.assigned_at, dot: 'var(--it)' })
  }
  timeline.push({
    text: 'Registered' + (asset.delivery_date ? ' · warehouse delivery' : ''),
    date: asset.purchased_on ?? asset.created_at.slice(0, 10),
    dot: '#B9C2D6',
    note: asset.vendor ?? undefined,
  })

  const sameUser = asset.assigned_to
    ? allAssets.filter((x) => x.assigned_to === asset.assigned_to && x.id !== asset.id)
    : []
  const userSeats = asset.assigned_to
    ? licenses.filter((l) => l.license_assignments.some((la) => la.profile_id === asset.assigned_to))
    : []

  const field = (label: string, value: string, isMono = false) => (
    <div>
      <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#8FA0BE', letterSpacing: '.4px' }}>{label}</div>
      <div style={{ fontSize: 12.5, color: 'var(--text)', marginTop: 2, fontFamily: isMono ? 'var(--font-mono)' : undefined }}>{value}</div>
    </div>
  )

  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(16,25,46,.18)', zIndex: 40 }} />
      <div style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 440, maxWidth: '92vw',
        background: '#fff', zIndex: 41, boxShadow: '-12px 0 40px rgba(16,25,46,.18)',
        display: 'flex', flexDirection: 'column',
      }}>
        <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid #EDEFF4' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className="chip" style={mono({ background: 'var(--ink)', color: '#fff', borderRadius: 6, fontSize: 11 })}>{asset.tag}</span>
            <span className="chip" style={{ background: st.bg, color: st.fg }}>{st.label}</span>
            <span style={{ flex: 1 }} />
            <button className="btn" style={{ padding: '3px 10px', fontSize: 11.5 }} onClick={() => setEditing(!editing)}>
              {editing ? 'Cancel' : 'Edit'}
            </button>
            <button onClick={onClose} style={{ width: 26, height: 26, borderRadius: 7, border: 'none', background: 'var(--surface)', cursor: 'pointer', color: 'var(--muted)' }}>✕</button>
          </div>
          <h3 style={{ fontSize: 18, marginTop: 12 }}>{asset.model ?? asset.category.replace('_', ' ')}</h3>
          <div style={mono({ fontSize: 11, color: 'var(--muted)', marginTop: 3 })}>
            {asset.serial ?? 'no serial'}{asset.location ? ` · ${asset.location}` : ''}
          </div>
        </div>

        <div style={{ padding: '16px 24px', overflowY: 'auto', flex: 1 }}>
          {editing ? (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 14px' }}>
              {([
                ['Tag', 'tag', 'text'], ['Model', 'model', 'text'], ['Serial', 'serial', 'text'],
                ['Manufacturer', 'manufacturer', 'text'], ['Vendor', 'vendor', 'text'],
                ['PO number', 'po_number', 'text'], ['Cost (SAR)', 'cost', 'number'],
                ['Delivered', 'delivery_date', 'date'], ['Warranty start', 'warranty_start', 'date'],
                ['Warranty end', 'warranty_end', 'date'], ['Location', 'location', 'text'],
              ] as const).map(([lbl, key, type]) => (
                <div key={key}>
                  <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#8FA0BE', letterSpacing: '.4px', marginBottom: 3 }}>{lbl}</div>
                  <input className="input" type={type} style={{ fontSize: 12 }}
                    value={f[key]} onChange={(e) => setF({ ...f, [key]: e.target.value })} />
                </div>
              ))}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', color: '#8FA0BE', letterSpacing: '.4px', marginBottom: 3 }}>Category</div>
                <select className="input" style={{ fontSize: 12 }} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>
                  {Object.keys(CAT_CODE).map((c) => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div style={{ gridColumn: '1 / -1', display: 'flex', gap: 8, marginTop: 4 }}>
                <button className="btn primary" style={{ flex: 1 }} onClick={saveEdit} disabled={!f.tag.trim()}>Save changes</button>
                <button className="btn" style={{ color: 'var(--red)', borderColor: 'var(--red)' }} onClick={deleteAsset}>Delete asset</button>
              </div>
            </div>
          ) : (
          <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px 18px' }}>
            {field('Category', `${asset.category.replace('_', ' ')}${asset.manufacturer ? ` · ${asset.manufacturer}` : ''}`)}
            {field('Vendor', asset.vendor ?? '—')}
            {field('Cost', asset.cost != null ? `SAR ${asset.cost.toLocaleString()}` : '—', true)}
            {field('Delivered', asset.delivery_date ?? asset.purchased_on ?? '—', true)}
            {field('Warranty', asset.warranty_start || asset.warranty_end ? `${mmYY(asset.warranty_start)} → ${mmYY(asset.warranty_end)}` : '—', true)}
            {field('Current user', holder ?? 'Unassigned')}
          </div>

          <div style={{ ...label10, margin: '18px 0 8px' }}>Assignment history</div>
          {timeline.map((t, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, position: 'relative', paddingBottom: 12 }}>
              {i < timeline.length - 1 && (
                <span style={{ position: 'absolute', left: 4, top: 12, bottom: 0, width: 2, background: '#EDEFF4' }} />
              )}
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: t.dot, marginTop: 3, flexShrink: 0, zIndex: 1 }} />
              <div>
                <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink)' }}>{t.text}</div>
                <div style={mono({ fontSize: 10.5, color: '#8FA0BE' })}>
                  {t.date ?? '—'}{t.note ? ` · ${t.note}` : ''}
                </div>
              </div>
            </div>
          ))}

          {holder && (sameUser.length > 0 || userSeats.length > 0) && (
            <>
              <div style={{ ...label10, margin: '14px 0 8px' }}>Also issued to {holder}</div>
              {sameUser.slice(0, 4).map((x) => (
                <div key={x.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                  <span style={mono({ fontSize: 10.5, background: 'var(--it-soft)', color: 'var(--it)', borderRadius: 5, padding: '2px 5px' })}>
                    {CAT_CODE[x.category] ?? 'AS'}
                  </span>
                  <span style={{ flex: 1 }}>{x.model ?? x.category}</span>
                  <span style={mono({ fontSize: 10.5, color: 'var(--muted)' })}>{x.serial?.slice(-5) ?? x.tag}</span>
                </div>
              ))}
              {userSeats.slice(0, 3).map((l) => (
                <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
                  <span style={mono({ fontSize: 10.5, background: 'var(--admin-soft)', color: 'var(--admin)', borderRadius: 5, padding: '2px 5px' })}>SW</span>
                  <span style={{ flex: 1 }}>{l.name} seat</span>
                  <span style={mono({ fontSize: 10.5, color: l.subscription_status === 'expired' ? 'var(--red)' : 'var(--green)' })}>
                    {l.subscription_status}
                  </span>
                </div>
              ))}
            </>
          )}
          </>
          )}
        </div>

        <div style={{ padding: '14px 24px', borderTop: '1px solid #EDEFF4', display: 'flex', gap: 8 }}>
          {reassigning ? (
            <PersonPicker
              people={people}
              placeholder="Reassign to… (type a name)"
              onPick={(p) => rpc('assign_asset', { p_asset: asset.id, p_profile: p.id })}
            />
          ) : (
            <button className="btn primary" style={{ flex: 1 }} onClick={() => setReassigning(true)}>
              {asset.status === 'assigned' ? 'Reassign' : 'Assign'}
            </button>
          )}
          <button
            className="btn" style={{ flex: 1 }}
            disabled={asset.status !== 'assigned'}
            onClick={() => rpc('return_asset', { p_asset: asset.id })}
          >
            Mark returned
          </button>
          <button className="btn" style={{ width: 42 }} title="Print QR label" onClick={() => printLabels([asset])}>⋯</button>
        </div>
      </div>
    </>
  )
}

/* ========================= Software & licenses (5b) ========================= */

function Software({ licenses, people, vms, credit, reload, setError, canApprove }: {
  licenses: License[]
  people: Person[]
  vms: CloudRes[]
  credit: CreditRow[]
  reload: () => void
  setError: (e: string | null) => void
  canApprove: boolean
}) {
  const [openId, setOpenId] = useState<string | null>(null)
  const [showLapsedOnly, setShowLapsedOnly] = useState(false)
  const [form, setForm] = useState({ name: '', vendor: '', seats: '5', expires: '' })
  const [editId, setEditId] = useState<string | null>(null)
  const [ef, setEf] = useState({ name: '', billing: '', seats: '', expires: '' })

  const startEdit = (l: License) => {
    setEditId(l.id)
    setEf({ name: l.name, billing: l.billing_profile ?? l.vendor ?? '', seats: String(l.seats), expires: l.expires_on ?? '' })
  }
  const saveEdit = async (l: License) => {
    setError(null)
    const { error: e } = await supabase.from('licenses').update({
      name: ef.name.trim(), billing_profile: ef.billing.trim() || null,
      seats: Math.max(1, Number(ef.seats) || l.seats), expires_on: ef.expires || null,
    }).eq('id', l.id)
    if (e) setError(e.message)
    setEditId(null)
    reload()
  }
  const deleteLicense = async (l: License) => {
    if (!window.confirm(`Delete subscription "${l.name}" and its ${l.license_assignments.length} seat assignment(s)?`)) return
    setError(null)
    const { error: e } = await supabase.from('licenses').delete().eq('id', l.id)
    if (e) setError(e.message)
    reload()
  }

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

  const today = new Date().toISOString().slice(0, 10)
  const isLapsed = (l: License) =>
    l.subscription_status === 'active' && l.status === 'active' && !!l.expires_on && l.expires_on < today
  const active = licenses.filter((l) => l.subscription_status === 'active' && l.status !== 'rejected')
  const disabled = licenses.filter((l) => l.subscription_status === 'expired')
  const lapsed = active.filter(isLapsed)
  const seatsTotal = active.reduce((s, l) => s + l.seats, 0)
  const seatsUsed = active.reduce((s, l) => s + Math.min(l.license_assignments.length, l.seats), 0)
  const fullyUsed = active.filter((l) => l.seats - l.license_assignments.length <= 0).length
  const upcoming = active
    .filter((l) => l.expires_on && l.expires_on >= today)
    .sort((a, b) => (a.expires_on! < b.expires_on! ? -1 : 1))
  const next = upcoming[0]
  const shown = (showLapsedOnly ? lapsed : active).slice(0, 12)
  const latestCredit = credit[credit.length - 1]

  return (
    <>
      {lapsed.length > 0 && (
        <div style={{
          background: '#FBEBEB', border: '1px solid #F0CECE', borderRadius: 12,
          padding: '11px 16px', display: 'flex', gap: 12, alignItems: 'center', marginBottom: 14,
        }}>
          <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.5px', color: 'var(--red)' }}>LAPSED</span>
          <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)', flex: 1 }}>
            {lapsed.length} subscription{lapsed.length > 1 ? 's are' : ' is'} past expiry but still marked active — {lapsed.slice(0, 2).map((l) => `${l.name} (${new Date(l.expires_on!).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })})`).join(' and ')}
          </span>
          <button
            onClick={() => setShowLapsedOnly(!showLapsedOnly)}
            style={{ background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-body)' }}
          >
            {showLapsedOnly ? 'Show all' : 'Review renewals'}
          </button>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <StatCard label="Seats in use" value={seatsUsed} suffix={`of ${seatsTotal}`} />
        <StatCard label="Fully used" value={fullyUsed} suffix="0 seats free" color="var(--amber)" />
        <StatCard label="Past expiry" value={lapsed.length} suffix="need action" color="var(--red)" />
        <StatCard label="Next renewal" value={next?.expires_on ? monthShort(next.expires_on) : '—'} suffix={next?.name.slice(0, 16) ?? ''} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, alignItems: 'start' }}>
        <div className="card">
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 130px 90px 96px', gap: 12, padding: '9px 16px', borderBottom: '1px solid #EDEFF4' }}>
            {['Subscription', 'Seats', 'Expires', 'Status'].map((h) => <span key={h} style={HEAD_CELL}>{h}</span>)}
          </div>
          {shown.map((l) => {
            const used = Math.min(l.license_assignments.length, l.seats)
            const free = l.seats - used
            const pct = Math.min(100, (used / l.seats) * 100)
            const fill = free <= 0 ? 'var(--amber)' : pct >= 70 ? 'var(--green)' : 'var(--it)'
            const lapsedRow = isLapsed(l)
            const open = openId === l.id
            return (
              <div key={l.id} style={{ background: lapsedRow ? '#FDF7F7' : undefined, borderBottom: '1px solid #EDEFF4' }}>
                <div
                  onClick={() => setOpenId(open ? null : l.id)}
                  style={{ display: 'grid', gridTemplateColumns: '1.5fr 130px 90px 96px', gap: 12, padding: '10px 16px', alignItems: 'center', cursor: 'pointer' }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 12.5, fontWeight: 500, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
                    <span style={{ fontSize: 10, color: '#8FA0BE' }}>
                      {[l.billing_profile ?? l.vendor, l.po_number ? `PO ${l.po_number}` : null].filter(Boolean).join(' · ') || '—'}
                    </span>
                  </span>
                  <span>
                    <span style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={mono({ fontSize: 10, color: 'var(--muted)' })}>{used}/{l.seats}</span>
                      <span style={mono({ fontSize: 10, color: free <= 0 ? 'var(--amber)' : 'var(--muted)' })}>{free} free</span>
                    </span>
                    <span style={{ display: 'block', background: 'var(--surface)', borderRadius: 3, height: 7, marginTop: 2, overflow: 'hidden' }}>
                      <span style={{ display: 'block', width: `${Math.max(3, pct)}%`, height: '100%', background: fill }} />
                    </span>
                  </span>
                  <span style={mono({ fontSize: 11, color: lapsedRow ? 'var(--red)' : undefined })}>{l.expires_on ? mmYY(l.expires_on) : '—'}</span>
                  <span>
                    {l.status === 'pending' ? (
                      <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>Pending</span>
                    ) : l.status === 'rejected' ? (
                      <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>Rejected</span>
                    ) : lapsedRow ? (
                      <span className="chip" style={{ background: '#FBEBEB', color: 'var(--red)' }}>Lapsed</span>
                    ) : (
                      <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>Active</span>
                    )}
                  </span>
                </div>
                {open && (
                  <div style={{ padding: '4px 16px 12px' }}>
                    {editId === l.id ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
                        <input className="input" style={{ flex: 2, minWidth: 140 }} value={ef.name} onChange={(e) => setEf({ ...ef, name: e.target.value })} />
                        <input className="input" style={{ flex: 1, minWidth: 100 }} placeholder="Billing profile" value={ef.billing} onChange={(e) => setEf({ ...ef, billing: e.target.value })} />
                        <input className="input" type="number" style={{ width: 70 }} value={ef.seats} onChange={(e) => setEf({ ...ef, seats: e.target.value })} />
                        <input className="input" type="date" style={{ width: 135 }} value={ef.expires} onChange={(e) => setEf({ ...ef, expires: e.target.value })} />
                        <button className="btn primary" style={{ padding: '5px 12px' }} onClick={() => saveEdit(l)} disabled={!ef.name.trim()}>Save</button>
                        <button className="btn" style={{ padding: '5px 12px' }} onClick={() => setEditId(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button className="btn" style={{ padding: '3px 10px', fontSize: 11 }} onClick={() => startEdit(l)}>Edit</button>
                        <button className="btn" style={{ padding: '3px 10px', fontSize: 11, color: 'var(--red)' }} onClick={() => deleteLicense(l)}>Delete</button>
                      </div>
                    )}
                    {l.status === 'pending' && canApprove && (
                      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                        <button className="btn primary" style={{ padding: '5px 12px' }} onClick={() => rpc('decide_license', { p_license: l.id, p_approve: true })}>Approve</button>
                        <button className="btn" style={{ padding: '5px 12px' }} onClick={() => rpc('decide_license', { p_license: l.id, p_approve: false })}>Reject</button>
                      </div>
                    )}
                    {l.status === 'active' && (
                      <>
                        {l.license_assignments.slice(0, 8).map((la) => (
                          <div key={la.profile_id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '3px 0', fontSize: 12 }}>
                            <span style={{ flex: 1 }}>{la.profile?.display_name ?? '—'}</span>
                            <span style={mono({ fontSize: 10.5, color: 'var(--muted)' })}>since {new Date(la.assigned_at).toLocaleDateString()}</span>
                            <button className="btn" style={{ padding: '2px 8px', color: 'var(--red)', fontSize: 11 }}
                              onClick={() => rpc('revoke_license', { p_license: l.id, p_profile: la.profile_id })}>revoke</button>
                          </div>
                        ))}
                        {l.license_assignments.length > 8 && (
                          <div className="row-desc">+ {l.license_assignments.length - 8} more assignees</div>
                        )}
                        <div style={{ marginTop: 6, maxWidth: 260, display: 'flex' }}>
                          <PersonPicker
                            people={people.filter((p) => !l.license_assignments.some((la) => la.profile_id === p.id))}
                            placeholder="Assign a seat… (type a name)"
                            onPick={(p) => rpc('assign_license', { p_license: l.id, p_profile: p.id })}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', padding: '10px 16px' }}>
            <input className="input" style={{ flex: 2, minWidth: 140 }} placeholder="Request new subscription…" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <input className="input" style={{ flex: 1, minWidth: 90 }} placeholder="Vendor" value={form.vendor} onChange={(e) => setForm({ ...form, vendor: e.target.value })} />
            <input className="input" type="number" style={{ width: 70 }} title="Seats" value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} />
            <input className="input" type="date" style={{ width: 135 }} value={form.expires} onChange={(e) => setForm({ ...form, expires: e.target.value })} />
            <button className="btn primary" onClick={request} disabled={!form.name.trim()}>+ Add subscription</button>
            <span style={{ fontSize: 10.5, color: 'var(--muted)', width: '100%' }}>New subscriptions require IT department head approval before seats can be assigned.</span>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ ...label10, marginBottom: 8 }}>Upcoming renewals</div>
            {upcoming.slice(0, 5).map((l) => {
              const near = new Date(l.expires_on!).getTime() < Date.now() + 90 * DAY
              return (
                <div key={l.id} style={{ display: 'flex', gap: 10, padding: '4px 0', alignItems: 'baseline' }}>
                  <span style={mono({ fontSize: 10.5, width: 48, flexShrink: 0, color: near ? 'var(--amber)' : 'var(--muted)', textTransform: 'uppercase' })}>
                    {monthShort(l.expires_on!)}
                  </span>
                  <span style={{ fontSize: 12, flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
                  <span style={mono({ fontSize: 10, color: 'var(--muted)' })}>{l.seats} seats</span>
                </div>
              )
            })}
            {upcoming.length === 0 && <div className="row-desc">No dated renewals.</div>}
          </div>
          {disabled.length > 0 && (
            <div className="card" style={{ padding: '14px 16px' }}>
              <div style={{ ...label10, marginBottom: 8 }}>Disabled · {disabled.length}</div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {disabled.slice(0, 5).map((l) => (
                  <span key={l.id} className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{l.name.slice(0, 26)}</span>
                ))}
                {disabled.length > 5 && (
                  <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>+ {disabled.length - 5} more</span>
                )}
              </div>
            </div>
          )}
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ ...label10, marginBottom: 8 }}>Cloud snapshot</div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
              <span>AVD hosts</span>
              <span style={mono({ fontSize: 11, color: 'var(--muted)' })}>
                {vms.length} · {vms.filter((v) => (v.status ?? '').toLowerCase() === 'shutdown').length} deallocated
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0' }}>
              <span>Azure credit remaining</span>
              <span style={mono({ fontSize: 11, color: 'var(--green)' })}>
                {latestCredit?.ending_credit != null ? `SAR ${kFmt(latestCredit.ending_credit)}` : '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/* ============================= Cloud VMs (6b) ============================= */

function CloudVms({ vms, cloud, credit }: { vms: CloudRes[]; cloud: CloudRes[]; credit: CreditRow[] }) {
  const [showAll, setShowAll] = useState(false)
  const running = vms.filter((v) => (v.status ?? '').toLowerCase() !== 'shutdown')
  const deallocated = vms.length - running.length
  const poolOf = (n: string) => (n.toUpperCase().includes('SAP') ? 'ABC-AVD-SAP-HP' : n.toUpperCase().includes('GIS') ? 'GIS pool' : '—')
  const pools = { sap: vms.filter((v) => poolOf(v.name).includes('SAP')).length, gis: vms.filter((v) => poolOf(v.name) === 'GIS pool').length }
  const servers = cloud.filter((c) => c.kind === 'server')
  const azres = cloud.filter((c) => c.kind === 'azure_resource')
  const months = credit.slice(-4)
  const latest = months[months.length - 1]
  const burn = months.length >= 2 && months[0].ending_credit != null && latest?.ending_credit != null
    ? (months[0].ending_credit - latest.ending_credit) / (months.length - 1)
    : null
  const maxBal = Math.max(...months.map((m) => m.ending_credit ?? 0), 1)
  const sorted = [...vms].sort((a, b) => {
    const ra = (a.status ?? '').toLowerCase() !== 'shutdown' ? 0 : 1
    const rb = (b.status ?? '').toLowerCase() !== 'shutdown' ? 0 : 1
    return ra - rb || a.name.localeCompare(b.name)
  })
  const shown = showAll ? sorted : sorted.slice(0, 8)

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 14 }}>
        <StatCard label="AVD hosts" value={vms.length} suffix={`SAP ${pools.sap} · GIS ${pools.gis} · other ${vms.length - pools.sap - pools.gis}`} />
        <StatCard label="Assigned · running" value={running.length} color="var(--green)" />
        <StatCard label="Deallocated" value={deallocated} suffix="shut down" color="var(--muted)" />
        <StatCard label="Azure credit" value={latest?.ending_credit != null ? `SAR ${kFmt(latest.ending_credit)}` : '—'} suffix="remaining" color="var(--green)" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14, alignItems: 'start' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card">
            <div style={{ display: 'grid', gridTemplateColumns: '110px 1.2fr 1fr 110px', gap: 12, padding: '9px 16px', borderBottom: '1px solid #EDEFF4' }}>
              {['Host', 'Assigned user', 'Pool', 'State'].map((h) => <span key={h} style={HEAD_CELL}>{h}</span>)}
            </div>
            {shown.map((v) => {
              const off = (v.status ?? '').toLowerCase() === 'shutdown'
              const holder = v.owner_name && !['deallocated', 'in stock'].includes(v.owner_name.toLowerCase()) ? v.owner_name : null
              return (
                <div key={v.id} style={{ display: 'grid', gridTemplateColumns: '110px 1.2fr 1fr 110px', gap: 12, padding: '10px 16px', borderBottom: '1px solid #EDEFF4', alignItems: 'center' }}>
                  <span style={mono({ fontSize: 11, color: off ? 'var(--muted)' : 'var(--text)' })}>{v.name}</span>
                  <span>
                    {holder && !off
                      ? <span style={{ fontSize: 12 }}>{holder}</span>
                      : <span style={{ fontSize: 12, fontStyle: 'italic', color: '#8FA0BE' }}>Unassigned</span>}
                    {holder && off && <span style={{ display: 'block', fontSize: 10, color: '#8FA0BE' }}>last: {holder}</span>}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{poolOf(v.name)}</span>
                  <span>
                    <span className="chip" style={{ background: off ? 'var(--surface)' : 'var(--green-soft)', color: off ? 'var(--muted)' : 'var(--green)' }}>
                      {off ? 'Deallocated' : v.status ?? 'Running'}
                    </span>
                  </span>
                </div>
              )
            })}
            <div style={{ display: 'flex', padding: '9px 16px', alignItems: 'center' }}>
              <span style={mono({ fontSize: 11, color: 'var(--muted)' })}>1–{shown.length} of {vms.length}</span>
              <span style={{ flex: 1 }} />
              {vms.length > 8 && (
                <button onClick={() => setShowAll(!showAll)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 11.5, fontWeight: 600, fontFamily: 'var(--font-body)' }}>
                  {showAll ? 'Show fewer' : 'Show all →'}
                </button>
              )}
            </div>
          </div>

          {servers.length > 0 && (
            <div className="card">
              <div style={{ display: 'grid', gridTemplateColumns: '150px 1.4fr 90px 90px', gap: 12, padding: '9px 16px', borderBottom: '1px solid #EDEFF4' }}>
                {['Server', 'OS / owner', 'Env', 'Priority'].map((h) => <span key={h} style={HEAD_CELL}>{h}</span>)}
              </div>
              {servers.map((s) => (
                <div key={s.id} style={{ display: 'grid', gridTemplateColumns: '150px 1.4fr 90px 90px', gap: 12, padding: '10px 16px', borderBottom: '1px solid #EDEFF4', alignItems: 'center' }}>
                  <span style={mono({ fontSize: 11 })}>{s.name}</span>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {[s.os_or_type, s.owner_name].filter(Boolean).join(' · ')}
                  </span>
                  <span>
                    {s.environment && (
                      <span className="chip" style={{
                        background: (s.environment ?? '').toLowerCase() === 'prod' ? 'var(--red-soft)' : 'var(--green-soft)',
                        color: (s.environment ?? '').toLowerCase() === 'prod' ? 'var(--red)' : 'var(--green)',
                      }}>{s.environment}</span>
                    )}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{s.priority ?? '—'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline' }}>
              <div style={label10}>Credit balance</div>
              <span style={{ flex: 1 }} />
              {burn != null && burn > 0 && <span style={mono({ fontSize: 10.5, color: 'var(--red)' })}>≈ −{kFmt(burn)}/mo</span>}
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', height: 120, marginTop: 12 }}>
              {months.map((m, i) => {
                const latestBar = i === months.length - 1
                const hPct = Math.max(8, ((m.ending_credit ?? 0) / maxBal) * 100)
                return (
                  <div key={m.month} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
                    <span style={mono({ fontSize: 9.5, color: latestBar ? 'var(--accent)' : 'var(--muted)', marginBottom: 3 })}>
                      {m.ending_credit != null ? kFmt(m.ending_credit) : '—'}
                    </span>
                    <div style={{ width: '100%', height: `${hPct}%`, background: latestBar ? 'var(--accent)' : 'var(--ink-3)', borderRadius: '4px 4px 0 0' }} />
                    <span style={mono({ fontSize: 9.5, color: 'var(--muted)', marginTop: 4, textTransform: 'uppercase' })}>
                      {new Date(m.month).toLocaleDateString(undefined, { month: 'short' })}
                    </span>
                  </div>
                )
              })}
              {months.length === 0 && <div className="row-desc">No credit data imported.</div>}
            </div>
          </div>
          <div className="card" style={{ padding: '14px 16px' }}>
            <div style={{ ...label10, marginBottom: 8 }}>Network & identity</div>
            {azres.slice(0, 6).map((r) => (
              <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 12, padding: '3px 0' }}>
                <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.name}</span>
                <span style={mono({ fontSize: 10, color: 'var(--muted)', flexShrink: 0 })}>
                  {r.location ? r.location.split(' ').map((w) => w[0]).join('').toUpperCase() : r.os_or_type?.slice(0, 14) ?? ''}
                </span>
              </div>
            ))}
            {azres.length > 6 && <div className="row-desc">+ {azres.length - 6} more resources</div>}
            {azres.length === 0 && <div className="row-desc">No Azure resources imported.</div>}
          </div>
        </div>
      </div>
    </>
  )
}

/* ============================= People 360 (kept) ============================= */

function People({ people, assets, licenses, onOpenRequest }: {
  people: Person[]; assets: Asset[]; licenses: License[]; onOpenRequest: (id: string) => void
}) {
  const [selected, setSelected] = useState<Person | null>(null)
  const [requests, setRequests] = useState<Req[]>([])

  useEffect(() => {
    if (!selected) return
    supabase
      .from('requests')
      .select('id, ref, title, status, created_at')
      .eq('requester_id', selected.id)
      .eq('dept', 'IT')
      .order('created_at', { ascending: false })
      .limit(6)
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

  return (
    <>
      <button className="btn" style={{ marginBottom: 12 }} onClick={() => setSelected(null)}>← All people</button>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14, alignItems: 'start' }}>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ ...label10, marginBottom: 8 }}>Hardware · {myAssets.length}</div>
          {myAssets.map((a) => (
            <div key={a.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
              <span style={mono({ fontSize: 10.5, background: 'var(--it-soft)', color: 'var(--it)', borderRadius: 5, padding: '2px 5px' })}>{CAT_CODE[a.category] ?? 'AS'}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.model ?? a.category}</span>
              <span style={mono({ fontSize: 10.5, color: 'var(--muted)' })}>{a.tag}</span>
            </div>
          ))}
          {myAssets.length === 0 && <div className="row-desc">No devices.</div>}
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ ...label10, marginBottom: 8 }}>License seats · {myLicenses.length}</div>
          {myLicenses.map((l) => (
            <div key={l.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12 }}>
              <span style={mono({ fontSize: 10.5, background: 'var(--admin-soft)', color: 'var(--admin)', borderRadius: 5, padding: '2px 5px' })}>SW</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</span>
              <span style={mono({ fontSize: 10.5, color: l.subscription_status === 'expired' ? 'var(--red)' : 'var(--green)' })}>{l.subscription_status}</span>
            </div>
          ))}
          {myLicenses.length === 0 && <div className="row-desc">No seats.</div>}
        </div>
        <div className="card" style={{ padding: '14px 16px' }}>
          <div style={{ ...label10, marginBottom: 8 }}>Recent IT requests</div>
          {requests.map((r) => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 0', fontSize: 12, cursor: 'pointer' }} onClick={() => onOpenRequest(r.id)}>
              <span style={mono({ fontSize: 10.5, color: 'var(--accent)' })}>{r.ref}</span>
              <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
              <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10 }}>{r.status.replace('_', ' ')}</span>
            </div>
          ))}
          {requests.length === 0 && <div className="row-desc">No IT requests.</div>}
        </div>
      </div>
    </>
  )
}
