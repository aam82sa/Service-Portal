import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { DEPT_COLOR, type DeptCode } from '../../lib/types'
import { RequestForm, type FormField } from './RequestForm'
import { SEVERITY_STYLE } from '../admin/Announcements'

interface ServiceWithForm {
  id: string
  dept: DeptCode
  code: string
  name: string
  description: string | null
  form_schema: FormField[]
  parent_id: string | null
  request_type: 'incident' | 'request'
  default_priority: 'P1' | 'P2' | 'P3' | 'P4'
}

interface Banner {
  id: string
  title: string
  body: string | null
  severity: keyof typeof SEVERITY_STYLE
}

/** A category tile: matches by code prefix, or by department (e.g. Logistics). */
interface CatDef {
  key: string
  name: string
  desc: string
  icon: string
  soft: string
  fg: string
  prefix?: string
  depts?: DeptCode[]
}

/** One level-1 block. `categories: null` drills straight to a flat list. */
interface BlockDef {
  key: string
  name: string
  depts: DeptCode[]
  icon: string
  soft: string
  fg: string
  categories: CatDef[] | null
  hasIssuePath: boolean
}

const IT_CATEGORIES: CatDef[] = [
  { key: 'AC', prefix: 'AC', name: 'Access & identity', desc: 'Accounts, permissions, passwords, remote access', icon: 'key', soft: 'var(--it-soft)', fg: 'var(--it)' },
  { key: 'HW', prefix: 'HW', name: 'Hardware', desc: 'Devices, peripherals, repairs and returns', icon: 'monitor', soft: 'var(--it-soft)', fg: 'var(--it)' },
  { key: 'SW', prefix: 'SW', name: 'Software & licenses', desc: 'Installations, licenses, cloud subscriptions', icon: 'box', soft: 'var(--it-soft)', fg: 'var(--it)' },
  { key: 'NW', prefix: 'NW', name: 'Network & connectivity', desc: 'Wi-Fi, ports and firewall changes', icon: 'wifi', soft: 'var(--it-soft)', fg: 'var(--it)' },
  { key: 'EL', prefix: 'EL', name: 'Employee IT lifecycle', desc: 'Onboarding, offboarding and transfers', icon: 'users', soft: 'var(--it-soft)', fg: 'var(--it)' },
]

const ADMIN_CATEGORIES: CatDef[] = [
  { key: 'TR', prefix: 'TR', name: 'Travel & transport', desc: 'Business travel, visas, transport, expenses', icon: 'plane', soft: 'var(--admin-soft)', fg: 'var(--admin)' },
  { key: 'FM', prefix: 'FM', name: 'Facilities & maintenance', desc: 'Moves, room setup, cleaning', icon: 'tool', soft: 'var(--admin-soft)', fg: 'var(--admin)' },
  { key: 'GP', prefix: 'GP', name: 'Access & site security', desc: 'Gate passes, badges, parking', icon: 'id-badge', soft: 'var(--admin-soft)', fg: 'var(--admin)' },
  { key: 'DC', prefix: 'DC', name: 'Documents & letters', desc: 'Official letters, attestation, courier', icon: 'file-text', soft: 'var(--admin-soft)', fg: 'var(--admin)' },
  { key: 'GR', prefix: 'GR', name: 'Government relations', desc: 'Iqama, visas, government portals', icon: 'landmark', soft: 'var(--admin-soft)', fg: 'var(--admin)' },
  { key: 'OS', prefix: 'OS', name: 'Office services', desc: 'Stationery, supplies, catering, events', icon: 'coffee', soft: 'var(--admin-soft)', fg: 'var(--admin)' },
  { key: 'SA', prefix: 'SA', name: 'System access', desc: 'Access to Admin-owned systems', icon: 'shield', soft: 'var(--admin-soft)', fg: 'var(--admin)' },
  { key: 'LOG', depts: ['LOG'], name: 'Logistics', desc: 'Fleet and logistics services', icon: 'truck', soft: 'var(--log-soft)', fg: 'var(--log)' },
]

const DEPT_BLOCKS: BlockDef[] = [
  { key: 'IT', name: 'IT services', depts: ['IT'], icon: 'laptop', soft: 'var(--it-soft)', fg: 'var(--it)', categories: IT_CATEGORIES, hasIssuePath: true },
  { key: 'ADMINLOG', name: 'Administration & Logistics', depts: ['ADMIN', 'LOG'], icon: 'building', soft: 'var(--admin-soft)', fg: 'var(--admin)', categories: ADMIN_CATEGORIES, hasIssuePath: true },
  { key: 'PROC', name: 'Procurement', depts: ['PROC'], icon: 'shopping-cart', soft: 'var(--accent-soft)', fg: 'var(--accent)', categories: null, hasIssuePath: false },
]

const ICONS: Record<string, ReactNode> = {
  key: <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3-3.5 3.5" />,
  monitor: <><rect x="2" y="3" width="20" height="14" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" /></>,
  box: <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>,
  'alert-triangle': <><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></>,
  wifi: <><path d="M5 12.55a11 11 0 0 1 14.08 0" /><path d="M1.42 9a16 16 0 0 1 21.16 0" /><path d="M8.53 16.11a6 6 0 0 1 6.95 0" /><line x1="12" y1="20" x2="12.01" y2="20" /></>,
  users: <><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>,
  laptop: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M2 20h20" /></>,
  building: <><rect x="4" y="2" width="16" height="20" rx="1" /><line x1="9" y1="7" x2="9.01" y2="7" /><line x1="15" y1="7" x2="15.01" y2="7" /><line x1="9" y1="12" x2="9.01" y2="12" /><line x1="15" y1="12" x2="15.01" y2="12" /><path d="M10 22v-4h4v4" /></>,
  'shopping-cart': <><circle cx="9" cy="21" r="1" /><circle cx="20" cy="21" r="1" /><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" /></>,
  'plus-circle': <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" /></>,
  'chevron-right': <polyline points="9 18 15 12 9 6" />,
  'chevron-down': <polyline points="6 9 12 15 18 9" />,
  plane: <path d="M22 2 11 13M22 2l-7 20-4-9-9-4z" />,
  tool: <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />,
  'id-badge': <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="M15 8h3M15 12h3M6 16c.6-1.5 1.7-2 3-2s2.4.5 3 2" /></>,
  'file-text': <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" /><line x1="10" y1="9" x2="8" y2="9" /></>,
  landmark: <><line x1="3" y1="22" x2="21" y2="22" /><line x1="6" y1="18" x2="6" y2="11" /><line x1="10" y1="18" x2="10" y2="11" /><line x1="14" y1="18" x2="14" y2="11" /><line x1="18" y1="18" x2="18" y2="11" /><path d="M12 2 20 7H4z" /></>,
  coffee: <><path d="M18 8h1a4 4 0 0 1 0 8h-1" /><path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4z" /><line x1="6" y1="1" x2="6" y2="4" /><line x1="10" y1="1" x2="10" y2="4" /><line x1="14" y1="1" x2="14" y2="4" /></>,
  shield: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />,
  truck: <><rect x="1" y="3" width="15" height="13" /><path d="M16 8h4l3 3v5h-7V8z" /><circle cx="5.5" cy="18.5" r="2.5" /><circle cx="18.5" cy="18.5" r="2.5" /></>,
}

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true"
    >
      {ICONS[name]}
    </svg>
  )
}

const PRIORITY_CHIP: Record<string, { bg: string; fg: string; border: string }> = {
  P1: { bg: 'var(--red-soft)', fg: 'var(--red)', border: 'transparent' },
  P2: { bg: 'var(--amber-soft)', fg: 'var(--amber)', border: 'transparent' },
  P3: { bg: 'transparent', fg: 'var(--muted)', border: 'var(--line)' },
  P4: { bg: 'transparent', fg: 'var(--muted)', border: 'var(--line)' },
}

const prefixOf = (code: string) => (code.includes('-') ? code.split('-')[0] : '')
const catMatches = (c: CatDef, s: ServiceWithForm) =>
  c.depts ? c.depts.includes(s.dept) : prefixOf(s.code) === c.prefix

export function Portal() {
  const [services, setServices] = useState<ServiceWithForm[]>([])
  const [selected, setSelected] = useState<ServiceWithForm | null>(null)
  const [banners, setBanners] = useState<Banner[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [blockKey, setBlockKey] = useState<string | null>(null)
  const [path, setPath] = useState<'issue' | 'request' | null>(null)
  const [category, setCategory] = useState<string | null>(null)

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
      .select('id, dept, code, name, description, form_schema, parent_id, request_type, default_priority')
      .eq('is_active', true)
      .order('code')
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

  const block = DEPT_BLOCKS.find((b) => b.key === blockKey) ?? null
  const svcOf = (b: BlockDef) => services.filter((s) => b.depts.includes(s.dept))
  const blockServices = block ? svcOf(block) : []
  const incidents = blockServices.filter((s) => s.request_type === 'incident')
  const requests = blockServices.filter((s) => s.request_type !== 'incident')

  const categoryTiles = block?.categories
    ? [
        ...block.categories.map((c) => ({
          ...c,
          services: requests.filter((s) => catMatches(c, s)),
        })),
        ...(() => {
          const rest = requests.filter((s) => !block.categories!.some((c) => catMatches(c, s)))
          return rest.length > 0
            ? [{ key: 'OTHER', name: 'Other', desc: 'Everything else', icon: 'plus-circle', soft: block.soft, fg: block.fg, services: rest }]
            : []
        })(),
      ].filter((c) => c.services.length > 0)
    : []

  const reset = () => { setBlockKey(null); setPath(null); setCategory(null) }
  const crumbs: { label: string; go: () => void }[] = [{ label: 'Service portal', go: reset }]
  if (block) crumbs.push({ label: block.name, go: () => { setPath(null); setCategory(null) } })
  if (block && path === 'issue') crumbs.push({ label: 'Report an issue', go: () => {} })
  if (block && path === 'request') crumbs.push({ label: 'Request something', go: () => setCategory(null) })
  if (block && path === 'request' && category) {
    crumbs.push({ label: categoryTiles.find((t) => t.key === category)?.name ?? 'Other', go: () => {} })
  }

  const rows = (list: ServiceWithForm[], withDeptChip = false) => (
    <div className="card">
      {list.map((s) => {
        const c = DEPT_COLOR[s.dept]
        const p = PRIORITY_CHIP[s.default_priority] ?? PRIORITY_CHIP.P3
        const incident = s.request_type === 'incident'
        return (
          <button key={s.id} className="pc-row" onClick={() => setSelected(s)}>
            <span className="tile-code" style={{ background: c.soft, color: c.rail }}>{s.code}</span>
            <span className="pc-row-main">
              <span className="pc-row-name">{s.name}</span>
              {s.description && <span className="pc-row-desc">{s.description}</span>}
            </span>
            {withDeptChip && (
              <span className="chip" style={{ background: c.soft, color: c.rail, fontSize: 10 }}>{c.label}</span>
            )}
            <span
              className="chip"
              style={{
                fontSize: 10,
                background: incident ? 'var(--red-soft)' : 'var(--green-soft)',
                color: incident ? 'var(--red)' : 'var(--green)',
              }}
            >
              {incident ? 'Incident' : 'Request'}
            </span>
            <span
              className="chip mono"
              style={{ fontSize: 10, background: p.bg, color: p.fg, border: `1px solid ${p.border}` }}
            >
              {s.default_priority ?? 'P3'}
            </span>
            <span style={{ color: 'var(--muted)', display: 'inline-flex' }}><Icon name="chevron-right" size={15} /></span>
          </button>
        )
      })}
      {list.length === 0 && <div className="row-desc" style={{ padding: '12px 16px' }}>No services here yet.</div>}
    </div>
  )

  const bigBlock = (opts: {
    icon: string; iconBg: string; iconFg: string; title: string; count: string; go: () => void
  }) => (
    <button key={opts.title} className="pc-block" style={{ ['--pc-c' as string]: opts.iconFg }} onClick={opts.go}>
      <span className="pc-ico" style={{ background: opts.iconBg, color: opts.iconFg }}>
        <Icon name={opts.icon} size={24} />
      </span>
      <span className="pc-block-title">{opts.title}</span>
      <span className="pc-block-count">{opts.count}</span>
    </button>
  )

  let body: ReactNode
  if (!block) {
    body = (
      <>
        <div className="pc-section">Choose a department</div>
        <div className="pc-grid">
          {DEPT_BLOCKS.filter((b) => svcOf(b).length > 0).map((b) =>
            bigBlock({
              icon: b.icon, iconBg: b.soft, iconFg: b.fg, title: b.name,
              count: `${svcOf(b).length} service${svcOf(b).length > 1 ? 's' : ''}`,
              go: () => setBlockKey(b.key),
            }))}
        </div>
      </>
    )
  } else if (block.hasIssuePath && path === null) {
    body = (
      <>
        <div className="pc-section">What do you need?</div>
        <div className="pc-grid">
          {bigBlock({
            icon: 'alert-triangle', iconBg: 'var(--red-soft)', iconFg: 'var(--red)',
            title: 'Report an issue', count: `Something is broken · ${incidents.length} service${incidents.length === 1 ? '' : 's'}`, go: () => setPath('issue'),
          })}
          {bigBlock({
            icon: 'plus-circle', iconBg: 'var(--green-soft)', iconFg: 'var(--green)',
            title: 'Request something', count: `${requests.length} services`, go: () => setPath('request'),
          })}
        </div>
      </>
    )
  } else if (block.hasIssuePath && path === 'issue') {
    body = rows(incidents, block.depts.length > 1)
  } else if (block.categories && path === 'request' && category === null) {
    body = (
      <div className="pc-cat-grid">
        {categoryTiles.map((c) => (
          <button key={c.key} className="pc-cat" onClick={() => setCategory(c.key)}>
            <span className="pc-ico pc-ico-sm" style={{ background: c.soft, color: c.fg }}>
              <Icon name={c.icon} size={19} />
            </span>
            <span className="pc-block-title" style={{ fontSize: 13.5 }}>{c.name}</span>
            <span className="pc-row-desc">{c.desc}</span>
            <span className="pc-block-count">{c.services.length} service{c.services.length === 1 ? '' : 's'}</span>
          </button>
        ))}
      </div>
    )
  } else if (block.categories && path === 'request' && category) {
    body = rows(categoryTiles.find((c) => c.key === category)?.services ?? [], block.depts.length > 1)
  } else {
    // no categories configured (or request path without tiles): flat list
    body = rows(path === 'request' ? requests : blockServices, block.depts.length > 1)
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
      {block && (
        <div className="pc-crumb">
          {crumbs.map((c, i) => (
            <span key={i}>
              {i > 0 && <span className="pc-crumb-sep">/</span>}
              {i < crumbs.length - 1
                ? <button className="pc-crumb-link" onClick={c.go}>{c.label}</button>
                : <span>{c.label}</span>}
            </span>
          ))}
        </div>
      )}
      {body}
      {!loaded && !error && <p className="page-sub">Loading catalog…</p>}
      {loaded && services.length === 0 && !error && (
        <p className="page-sub">No services in the catalog yet.</p>
      )}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
