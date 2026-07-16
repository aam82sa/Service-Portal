import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { toCsv } from '../../lib/csv'
import { PersonPicker } from '../../components/PersonPicker'

interface AuditRow {
  source: 'admin' | 'request' | 'letter'
  event_id: number
  created_at: string
  actor_name: string
  area: string
  action: string
  ref: string | null
  detail: Record<string, unknown>
}

interface Person { id: string; display_name: string }

const PAGE = 50

const SOURCE_COLOR: Record<AuditRow['source'], { bg: string; fg: string }> = {
  admin: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  request: { bg: 'var(--it-soft)', fg: 'var(--it)' },
  letter: { bg: 'var(--amber-soft)', fg: 'var(--amber)' },
}

/**
 * Read-only viewer over admin_events + request_events + letter_events via
 * the audit_log_entries RPC (system admin: everything; dept admin/head:
 * their department's request/letter events).
 */
export function AuditLog() {
  const [rows, setRows] = useState<AuditRow[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [source, setSource] = useState('')
  const [actor, setActor] = useState<Person | null>(null)
  const [area, setArea] = useState('')
  const [ref, setRef] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const params = useCallback(() => ({
    p_source: source || null,
    p_actor: actor?.id ?? null,
    p_area: area.trim() || null,
    p_ref: ref.trim() || null,
    p_from: from ? new Date(from).toISOString() : null,
    p_to: to ? new Date(`${to}T23:59:59.999`).toISOString() : null,
  }), [source, actor, area, ref, from, to])

  const load = useCallback(() => {
    supabase.rpc('audit_log_entries', { ...params(), p_limit: PAGE, p_offset: page * PAGE })
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        else { setError(null); setRows((data as AuditRow[]) ?? []) }
      })
  }, [params, page])
  useEffect(load, [load])

  useEffect(() => {
    supabase.from('profiles').select('id, display_name').eq('is_active', true).order('display_name')
      .then(({ data }) => setPeople((data as Person[]) ?? []))
  }, [])

  const exportCsv = async () => {
    // export honours the current filters, not the current page (up to 500 rows)
    const { data, error: e } = await supabase.rpc('audit_log_entries', { ...params(), p_limit: 500, p_offset: 0 })
    if (e) return setError(e.message)
    const csv = toCsv((data as AuditRow[]) ?? [], [
      { key: 'created_at', header: 'Timestamp' },
      { key: 'source', header: 'Source' },
      { key: 'actor_name', header: 'Actor' },
      { key: 'area', header: 'Area' },
      { key: 'action', header: 'Action' },
      { key: 'ref', header: 'Ref' },
      { key: 'detail', header: 'Detail' },
    ])
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <>
      <h2 className="page-head">Audit log</h2>
      <p className="page-sub">
        Everything the platform records: admin configuration changes, request lifecycle events,
        and correspondence events. Read-only — nothing here can be edited or deleted.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <select className="input" style={{ width: 130 }} value={source}
          onChange={(e) => { setSource(e.target.value); setPage(0) }}>
          <option value="">all sources</option>
          <option value="admin">admin config</option>
          <option value="request">requests</option>
          <option value="letter">letters</option>
        </select>
        <PersonPicker small width={170} people={people} value={actor?.id ?? null}
          placeholder="Actor…" onPick={(p) => { setActor(p); setPage(0) }} />
        {actor && (
          <button className="btn" style={{ padding: '2px 8px' }} onClick={() => { setActor(null); setPage(0) }}>
            × {actor.display_name}
          </button>
        )}
        <input className="input" style={{ width: 150 }} placeholder="Area / action"
          value={area} onChange={(e) => { setArea(e.target.value); setPage(0) }} />
        <input className="input" style={{ width: 150 }} placeholder="Ref (REQ-…, LTR-…)"
          value={ref} onChange={(e) => { setRef(e.target.value); setPage(0) }} />
        <input className="input" type="date" style={{ width: 140 }} title="From"
          value={from} onChange={(e) => { setFrom(e.target.value); setPage(0) }} />
        <input className="input" type="date" style={{ width: 140 }} title="To (inclusive)"
          value={to} onChange={(e) => { setTo(e.target.value); setPage(0) }} />
        <span style={{ flex: 1 }} />
        <button className="btn" onClick={exportCsv}>Export CSV</button>
      </div>

      <div className="card">
        <div className="aud-head">
          <span>Timestamp</span><span>Source</span><span>Actor</span><span>Area</span><span>Event</span><span>Ref</span>
        </div>
        {rows.map((r) => (
          <div className="aud-row" key={`${r.source}-${r.event_id}`} title={JSON.stringify(r.detail, null, 2)}>
            <span className="ts">{new Date(r.created_at).toLocaleString()}</span>
            <span>
              <span className="chip" style={{ background: SOURCE_COLOR[r.source].bg, color: SOURCE_COLOR[r.source].fg }}>
                {r.source}
              </span>
            </span>
            <span className="actor">{r.actor_name}</span>
            <span>
              <span className="chip mono" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
                {r.area}
              </span>
            </span>
            <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.action.replace(/_/g, ' ')}
              <span className="detail" style={{ marginInlineStart: 8 }}>{JSON.stringify(r.detail)}</span>
            </span>
            <span className="ref">{r.ref ?? '\u2014'}</span>
          </div>
        ))}
        {rows.length === 0 && <div className="row row-desc">No events match these filters.</div>}
        <div className="pager">
          <span className="readonly-flag">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            Read-only ledger
          </span>
          <span className="mid">page {page + 1} · {PAGE} per page · export honours filters (up to 500 rows)</span>
          <button className="btn" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>← Newer</button>
          <button className="btn" disabled={rows.length < PAGE} onClick={() => setPage((p) => p + 1)}>Older →</button>
        </div>
      </div>
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
