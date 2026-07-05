import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { Chip, MetricCard, SectionLabel } from '../../components/ui'
import {
  DEPT_COLOR, PORTAL_DEPTS, PROJECT_STATUS_META,
  type DeptCode, type Project, type ProjectStatus,
} from '../../lib/types'

interface ConversionRow {
  id: string
  source_department: DeptCode
  status: string
  decision_notes: string | null
  requester: { display_name: string } | null
  proposed_pm: { display_name: string } | null
  request: { ref: string; title: string } | null
}

const OPEN_STATUSES: ProjectStatus[] = [
  'draft', 'charter_submitted', 'charter_approval', 'planning', 'baselined', 'active', 'on_hold', 'closing',
]

export function Projects({ onOpen }: { onOpen: (id: string) => void }) {
  const { profile, hasRole } = useAuth()
  const [items, setItems] = useState<Project[]>([])
  const [conversions, setConversions] = useState<ConversionRow[]>([])
  const [filter, setFilter] = useState<'open' | 'all'>('open')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<DeptCode[]>([])
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const isDeptHead = hasRole('dept_head')
  const canCreate =
    hasRole('project_manager') || hasRole('pmo_admin') || hasRole('agent') ||
    hasRole('team_lead') || hasRole('dept_head') || hasRole('system_admin')

  const load = useCallback(() => {
    supabase
      .from('projects')
      .select('*, pm:profiles!projects_project_manager_id_fkey(display_name)')
      .order('created_at', { ascending: false })
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else setItems((data as unknown as Project[]) ?? [])
        setLoaded(true)
      })
    if (isDeptHead) {
      supabase
        .from('project_conversion_requests')
        .select(
          'id, source_department, status, decision_notes, requester:profiles!project_conversion_requests_requested_by_fkey(display_name), proposed_pm:profiles!project_conversion_requests_proposed_pm_id_fkey(display_name), request:requests!project_conversion_requests_source_request_id_fkey(ref, title)'
        )
        .eq('status', 'pending_dept_head')
        .then(({ data }) => setConversions((data as unknown as ConversionRow[]) ?? []))
    }
  }, [isDeptHead])

  useEffect(load, [load])

  const create = async () => {
    setError(null)
    const { data, error: e } = await supabase
      .from('projects')
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        department_scope: scope,
        project_manager_id: profile?.id ?? null,
      })
      .select('id')
      .single()
    if (e) { setError(e.message); return }
    setCreating(false)
    setName(''); setDescription(''); setScope([])
    if (data) onOpen(data.id)
  }

  const decideConversion = async (c: ConversionRow, approve: boolean) => {
    setError(null)
    const { error: e } = await supabase
      .from('project_conversion_requests')
      .update({ status: approve ? 'approved' : 'rejected' })
      .eq('id', c.id)
    if (e) setError(e.message)
    load()
  }

  const visible = filter === 'open' ? items.filter((p) => OPEN_STATUSES.includes(p.status)) : items
  const count = (ss: ProjectStatus[]) => items.filter((p) => ss.includes(p.status)).length

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <div style={{ flex: 1 }}>
          <h2 className="page-head">Projects</h2>
          <p className="page-sub">
            Chartered work coordinated by the PMO — delivery still flows through the
            department service catalogs.
          </p>
        </div>
        {canCreate && (
          <button className="btn primary" onClick={() => setCreating(true)}>+ New project</button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <MetricCard label="Active" value={count(['active'])} tone="green" />
        <MetricCard label="In planning" value={count(['planning', 'baselined'])} tone="accent" />
        <MetricCard label="Awaiting charter" value={count(['draft', 'charter_submitted', 'charter_approval'])} tone="amber" />
        <MetricCard label="On hold" value={count(['on_hold'])} tone="amber" />
      </div>

      {isDeptHead && conversions.length > 0 && (
        <div className="card" style={{ marginBottom: 18, padding: 18 }}>
          <SectionLabel>Conversion requests awaiting your decision</SectionLabel>
          {conversions.map((c) => (
            <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderTop: '1px solid var(--line)' }}>
              <span className="mono" style={{ fontSize: 12 }}>{c.request?.ref}</span>
              <div style={{ flex: 1 }}>
                <div className="row-title">{c.request?.title}</div>
                <div className="row-desc">
                  raised by {c.requester?.display_name ?? '—'} · proposed PM {c.proposed_pm?.display_name ?? '—'}
                </div>
              </div>
              <Chip tone="muted">{DEPT_COLOR[c.source_department].label}</Chip>
              <button className="btn primary" onClick={() => decideConversion(c, true)}>Approve</button>
              <button className="btn" onClick={() => decideConversion(c, false)}>Reject</button>
            </div>
          ))}
        </div>
      )}

      {creating && (
        <div className="card" style={{ marginBottom: 18, padding: 18 }}>
          <SectionLabel>New project</SectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input className="input" placeholder="Project name" value={name} onChange={(e) => setName(e.target.value)} />
            <textarea
              className="input" rows={2} placeholder="Description (optional)"
              value={description} onChange={(e) => setDescription(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span className="row-desc">Departments involved:</span>
              {PORTAL_DEPTS.map((d) => (
                <Chip
                  key={d}
                  tone={scope.includes(d) ? 'accent' : 'muted'}
                  onClick={() => setScope((s) => (s.includes(d) ? s.filter((x) => x !== d) : [...s, d]))}
                >
                  {DEPT_COLOR[d].label}
                </Chip>
              ))}
              <span className="row-desc">(none = cross-functional)</span>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn primary" onClick={create} disabled={!name.trim()}>Create draft</button>
              <button className="btn" onClick={() => setCreating(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
        <Chip tone={filter === 'open' ? 'accent' : 'muted'} onClick={() => setFilter('open')}>Open</Chip>
        <Chip tone={filter === 'all' ? 'accent' : 'muted'} onClick={() => setFilter('all')}>All</Chip>
      </div>

      {visible.map((p) => {
        const meta = PROJECT_STATUS_META[p.status]
        return (
          <div
            className="card" key={p.id}
            style={{ marginBottom: 10, padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer' }}
            onClick={() => onOpen(p.id)}
          >
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink)', width: 68 }}>{p.code}</span>
            <div style={{ flex: 1 }}>
              <div className="row-title">{p.name}</div>
              <div className="row-desc">
                PM: {p.pm?.display_name ?? 'unassigned'}
                {p.origin_type === 'converted' ? ' · converted from a ticket' : ''}
              </div>
            </div>
            {p.department_scope.length === 0 ? (
              <Chip tone="muted">Cross-functional</Chip>
            ) : (
              p.department_scope.map((d) => <Chip key={d} tone="muted">{DEPT_COLOR[d]?.label ?? d}</Chip>)
            )}
            <Chip tone={meta.tone}>{meta.label}</Chip>
          </div>
        )
      })}
      {loaded && visible.length === 0 && !error && (
        <div className="card"><div className="row row-desc">No projects yet.</div></div>
      )}
      {!loaded && !error && <p className="page-sub">Loading…</p>}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
