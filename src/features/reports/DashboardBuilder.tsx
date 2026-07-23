/**
 * Zone 2 — the dashboard builder (reference: prototype/reporting-rebuild-
 * reference.html). Three panes: palette (data sources + widget types) ·
 * canvas (slot grid with live mini-previews) · properties (query, filters,
 * chart type). Saving writes report_dashboards/report_widgets under RLS;
 * the live-preview toggle renders each widget against query-live — the
 * caller's own permissions — as you edit, so nothing in the builder can
 * show rows the viewer couldn't fetch themselves.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthProvider'
import { SOURCE_META, WIDGET_ICO, WIDGET_LABEL, WIDGET_TYPES, sourceMeta, type WidgetType } from './builderMeta'
import { previewSupported, widgetToConfig, type WidgetDraft, type WidgetFilter } from './builderQuery'
import {
  getDashboardWidgets, listDashboards, listDepartments, saveDashboard,
  type DashboardRow, type DeptOption,
} from './dashboardsApi'
import { queryLive } from './queryLive'
import { CURATED_DASHBOARDS } from './dashboards'

type PreviewState =
  | { status: 'loading' }
  | { status: 'ok'; rows: Record<string, unknown>[]; columns: string[] }
  | { status: 'error'; message: string }
  | { status: 'na' }

const newWidget = (type: WidgetType): WidgetDraft => ({
  widget_type: type,
  data_source: 'requests',
  title: WIDGET_LABEL[type],
  config: { period: { preset: 'last30' }, filters: [{ col: 'status', op: 'neq', value: 'cancelled' }] },
})

/** the Zone 1 curated overview as a starting draft ("Duplicate to edit") */
const seedWidgets = (dept: string): WidgetDraft[] => {
  const deptFilter: WidgetFilter[] = dept === 'ALL' ? [] : [{ col: 'dept', op: 'eq', value: dept }]
  const base = { period: { preset: 'last30' as const }, filters: [...deptFilter, { col: 'status', op: 'neq', value: 'cancelled' } as WidgetFilter] }
  return [
    { widget_type: 'line', data_source: 'requests', title: 'Requests created vs resolved', config: { ...base } },
    { widget_type: 'bar', data_source: 'requests', title: 'Volume by service', config: { ...base, measure: 'count', group_by: 'service_code' } },
    { widget_type: 'donut', data_source: 'requests', title: 'By priority', config: { ...base, measure: 'count', group_by: 'priority' } },
    { widget_type: 'stacked', data_source: 'sla', title: 'SLA met vs breached', config: { ...base, group_by: 'status', split_by: 'status' } },
  ]
}

export function DashboardBuilder() {
  const { profile, hasRole } = useAuth()
  const ownerId = profile?.id ?? ''
  const [params, setParams] = useSearchParams()

  const [boards, setBoards] = useState<DashboardRow[]>([])
  const [departments, setDepartments] = useState<DeptOption[]>([])
  const [boardId, setBoardId] = useState<string | null>(null)
  const [name, setName] = useState('Untitled dashboard')
  const [visibility, setVisibility] = useState<'private' | 'dept' | 'org'>('private')
  const [deptId, setDeptId] = useState<string | null>(null)
  const [widgets, setWidgets] = useState<WidgetDraft[]>([])
  const [sel, setSel] = useState<number | null>(null)
  const [live, setLive] = useState(true)
  const [previews, setPreviews] = useState<Record<number, PreviewState>>({})
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    listDashboards().then(setBoards).catch(() => {})
    listDepartments().then(setDepartments).catch(() => {})
  }, [])

  // ?seed=<curated-slug>: duplicate the Zone 1 overview into a fresh draft
  useEffect(() => {
    const seed = params.get('seed')
    if (!seed) return
    const curated = CURATED_DASHBOARDS.find((d) => d.slug === seed)
    if (curated) {
      setBoardId(null)
      setName(`${curated.name} (copy)`)
      setWidgets(seedWidgets(curated.dept))
      setSel(1)
      setDirty(true)
    }
    const next = new URLSearchParams(params)
    next.delete('seed')
    setParams(next, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('seed')])

  const touch = () => { setDirty(true) }

  const loadBoard = async (b: DashboardRow) => {
    try {
      const rows = await getDashboardWidgets(b.id)
      setBoardId(b.id)
      setName(b.name)
      setVisibility(b.visibility)
      setDeptId(b.dept_id)
      setWidgets(rows.map((r) => ({
        id: r.id, widget_type: r.widget_type, data_source: r.data_source,
        title: r.title, config: r.config as WidgetDraft['config'],
      })))
      setSel(rows.length ? 0 : null)
      setDirty(false)
      setError(null)
    } catch (e) { setError((e as Error).message) }
  }

  const resetDraft = () => {
    setBoardId(null); setName('Untitled dashboard'); setVisibility('private'); setDeptId(null)
    setWidgets([]); setSel(null); setDirty(false); setError(null)
  }

  // ---- live previews: one query-live per supported widget, debounced ----
  const previewSeq = useRef(0)
  useEffect(() => {
    if (!live) return
    const seq = ++previewSeq.current
    const t = setTimeout(() => {
      widgets.forEach((w, i) => {
        if (!previewSupported(w.widget_type)) {
          setPreviews((p) => ({ ...p, [i]: { status: 'na' } }))
          return
        }
        setPreviews((p) => ({ ...p, [i]: { status: 'loading' } }))
        queryLive(w.data_source, widgetToConfig(w, new Date()))
          .then((res) => {
            if (seq !== previewSeq.current) return
            setPreviews((p) => ({ ...p, [i]: { status: 'ok', rows: res.rows, columns: res.columns } }))
          })
          .catch((e) => {
            if (seq !== previewSeq.current) return
            setPreviews((p) => ({ ...p, [i]: { status: 'error', message: (e as Error).message } }))
          })
      })
    }, 400)
    return () => clearTimeout(t)
  }, [widgets, live])

  const selected = sel !== null ? widgets[sel] : null
  const selectedMeta = selected ? sourceMeta(selected.data_source) : null

  const patchSelected = (patch: Partial<WidgetDraft> | { config: Partial<WidgetDraft['config']> }) => {
    if (sel === null) return
    setWidgets((ws) => ws.map((w, i) => {
      if (i !== sel) return w
      if ('config' in patch && patch.config) return { ...w, ...patch, config: { ...w.config, ...patch.config } }
      return { ...w, ...patch } as WidgetDraft
    }))
    touch()
  }

  const addWidget = (type: WidgetType) => {
    setWidgets((ws) => [...ws, newWidget(type)])
    setSel(widgets.length)
    touch()
  }

  const removeSelected = () => {
    if (sel === null) return
    setWidgets((ws) => ws.filter((_, i) => i !== sel))
    setSel(null)
    touch()
  }

  const doSave = async () => {
    if (!name.trim()) { setError('Give the dashboard a name first.'); return }
    if (visibility === 'dept' && !deptId) { setError('Pick the department this dashboard is shared with.'); return }
    setSaving(true); setError(null)
    try {
      const id = await saveDashboard({
        id: boardId ?? undefined, name: name.trim(), visibility,
        deptId: visibility === 'dept' ? deptId : null, ownerId, widgets,
      })
      setBoardId(id)
      setDirty(false)
      setSavedAt(new Date().toLocaleTimeString())
      listDashboards().then(setBoards).catch(() => {})
    } catch (e) { setError((e as Error).message) }
    finally { setSaving(false) }
  }

  const myBoards = useMemo(
    () => boards.filter((b) => b.owner_id === ownerId || (b.kind === 'builtin' && hasRole('system_admin'))),
    [boards, ownerId, hasRole])

  return (
    <section aria-label="Report builder">
      <div className="builder-bar">
        <h2>Report builder</h2>
        <span className="scope-badge scope-dept">
          {visibility === 'private' ? 'Custom · private' : visibility === 'dept' ? 'Custom · department' : 'Custom · organization'}
        </span>
        <span className={`chip ${dirty ? 't-amber' : 't-green'}`}>{dirty ? 'draft' : boardId ? 'published' : 'new'}</span>
        <span className="tool-spacer" style={{ flex: 1 }} />
        {savedAt && <span className="chip t-muted mono">saved {savedAt}</span>}
        <select
          className="input" style={{ maxWidth: 220 }} aria-label="Open a saved dashboard"
          value={boardId ?? ''}
          onChange={(e) => {
            const b = boards.find((x) => x.id === e.target.value)
            if (b) void loadBoard(b)
          }}
        >
          <option value="">Open saved…</option>
          {myBoards.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <button className="btn ghost" onClick={resetDraft}>New</button>
      </div>

      {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 10 }}>{error}</div>}

      <div className="builder">
        {/* palette */}
        <aside className="pane" aria-label="Data sources and widgets palette">
          <div className="pane-head">Palette</div>
          <div className="palette">
            <div className="pal-group">Data sources</div>
            {SOURCE_META.map((s) => (
              <button
                key={s.key} className="pal-item"
                onClick={() => patchSelected({ data_source: s.key, config: { measure: undefined, group_by: undefined } })}
                title={sel === null ? 'Select a widget first, then click a source to bind it' : `Bind the selected widget to ${s.label}`}
              >
                <span className="pal-ico">{s.ico}</span>{s.label}
                {s.personalData && <span className="pal-tag">personal data</span>}
              </button>
            ))}
            <div className="pal-group">Widgets</div>
            {WIDGET_TYPES.map((t) => (
              <button key={t} className="pal-item" onClick={() => addWidget(t)}>
                <span className="pal-ico">{WIDGET_ICO[t]}</span>{WIDGET_LABEL[t]}
              </button>
            ))}
            <p className="hint">Add a widget to the canvas, then bind it to a data source in Properties.</p>
          </div>
        </aside>

        {/* canvas */}
        <section className="pane" aria-label="Dashboard canvas">
          <div className="pane-head">
            <span>Canvas — {name}{dirty ? ' (draft)' : ''}</span>
            <span className="chip t-muted mono">{widgets.length} widget{widgets.length === 1 ? '' : 's'}</span>
          </div>
          <div className="b-canvas">
            <div className="slotgrid">
              {widgets.map((w, i) => (
                <button
                  key={i}
                  className={`slot${sel === i ? ' sel' : ''}`}
                  style={{ textAlign: 'start', fontFamily: 'var(--font-body)', cursor: 'pointer' }}
                  onClick={() => setSel(i)}
                  aria-current={sel === i || undefined}
                >
                  {sel === i && <span className="sel-tag">selected</span>}
                  <div className="mini-head">
                    <span className="mini-title">{w.title}</span>
                    <span className="chip t-it" style={{ fontSize: 9 }}>{WIDGET_LABEL[w.widget_type]}</span>
                  </div>
                  <div className="mini-body">
                    <MiniPreview widget={w} preview={live ? previews[i] : undefined} liveOff={!live} />
                    <div className="mini-hint">
                      {sourceMeta(w.data_source).label}
                      {w.config.group_by ? ` · grouped by ${w.config.group_by}` : ''}
                      {w.config.period?.preset === 'follow' ? ' · follows dashboard filter' : ` · ${w.config.period?.preset === 'quarter' ? 'last quarter' : 'last 30 days'}`}
                    </div>
                  </div>
                </button>
              ))}
              <button className="slot drop" onClick={() => addWidget('bar')}>
                <span className="plus">+</span>
                <span>Drop a widget</span>
              </button>
            </div>
          </div>

          {/* save bar */}
          <div className="savebar">
            <label className="prop-lbl" htmlFor="rb-name">Name</label>
            <input
              className="input" id="rb-name" value={name} style={{ minWidth: 210 }}
              onChange={(e) => { setName(e.target.value); touch() }}
            />
            <span className="prop-lbl" id="rb-vis" style={{ marginInlineStart: 6 }}>Visibility</span>
            <div className="seg" role="group" aria-labelledby="rb-vis">
              {(['private', 'dept', 'org'] as const).map((v) => (
                <button key={v} className={visibility === v ? 'on' : ''} onClick={() => { setVisibility(v); touch() }}>
                  {v === 'private' ? 'Private' : v === 'dept' ? 'Department' : 'Organization'}
                </button>
              ))}
            </div>
            {visibility === 'dept' && (
              <select className="input" style={{ maxWidth: 170 }} aria-label="Shared with department"
                value={deptId ?? ''} onChange={(e) => { setDeptId(e.target.value || null); touch() }}>
                <option value="">Department…</option>
                {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
            <span className="tool-spacer" style={{ flex: 1 }} />
            <button className="btn ghost" onClick={resetDraft}>Discard draft</button>
            <button className="btn primary" disabled={saving} onClick={doSave}>
              {saving ? 'Saving…' : 'Save & publish'}
            </button>
          </div>
        </section>

        {/* properties */}
        <aside className="pane" aria-label="Widget properties">
          <div className="pane-head"><span>Properties</span><span className="chip t-muted mono">widget</span></div>
          <div className="props">
            {!selected && <p className="mini-hint" style={{ margin: 0 }}>Select a widget on the canvas to edit its query, filters and chart type.</p>}
            {selected && selectedMeta && (
              <>
                <div className="p-name">{selected.title}</div>
                <div className="p-key">widget_{String((sel ?? 0) + 1).padStart(2, '0')} · source: {selectedMeta.label}</div>

                <div className="prop-sec">Query</div>
                <div className="prop-row">
                  <label className="prop-lbl" htmlFor="pw-title">Title</label>
                  <input className="input" id="pw-title" value={selected.title}
                    onChange={(e) => patchSelected({ title: e.target.value })} />
                </div>
                {!selectedMeta.fixed && (
                  <>
                    <div className="prop-row">
                      <label className="prop-lbl" htmlFor="pw-measure">Measure</label>
                      <select className="input" id="pw-measure" value={selected.config.measure ?? selectedMeta.measures[0]?.key}
                        onChange={(e) => patchSelected({ config: { measure: e.target.value } })}>
                        {selectedMeta.measures.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                      </select>
                    </div>
                    <div className="prop-row">
                      <label className="prop-lbl" htmlFor="pw-group">Group by</label>
                      <select className="input" id="pw-group" value={selected.config.group_by ?? selectedMeta.groupable[0]?.key}
                        onChange={(e) => patchSelected({ config: { group_by: e.target.value } })}>
                        {selectedMeta.groupable.map((g) => <option key={g.key} value={g.key}>{g.label}</option>)}
                      </select>
                    </div>
                    <div className="prop-row">
                      <label className="prop-lbl" htmlFor="pw-split">Split by</label>
                      <select className="input" id="pw-split" value={selected.config.split_by ?? ''}
                        onChange={(e) => patchSelected({ config: { split_by: e.target.value || null } })}>
                        <option value="">None</option>
                        <option value="status">Status</option>
                        <option value="priority">Priority</option>
                      </select>
                    </div>
                  </>
                )}
                <div className="prop-row">
                  <label className="prop-lbl" htmlFor="pw-period">Period</label>
                  <select className="input" id="pw-period" value={selected.config.period?.preset ?? 'last30'}
                    onChange={(e) => patchSelected({ config: { period: { preset: e.target.value as 'last30' | 'quarter' | 'follow' } } })}>
                    <option value="last30">Last 30 days</option>
                    <option value="quarter">Last quarter</option>
                    <option value="follow">Follow dashboard filter</option>
                  </select>
                </div>

                <div className="prop-sec">Filters</div>
                {(selected.config.filters ?? []).map((f, fi) => (
                  <div className="tr" key={fi}>
                    {f.col} <span className="op">{f.op === 'eq' ? '=' : '≠'}</span> {f.value}
                    <button className="x" aria-label={`Remove filter: ${f.col} ${f.op} ${f.value}`}
                      onClick={() => patchSelected({ config: { filters: (selected.config.filters ?? []).filter((_, j) => j !== fi) } })}>×</button>
                  </div>
                ))}
                <AddFilter onAdd={(f) => patchSelected({ config: { filters: [...(selected.config.filters ?? []), f] } })} />

                <div className="prop-sec">Chart type</div>
                <div className="seg full" role="group" aria-label="Chart type">
                  {(['kpi', 'line', 'bar', 'donut', 'table'] as WidgetType[]).map((t) => (
                    <button key={t} className={selected.widget_type === t ? 'on' : ''}
                      onClick={() => patchSelected({ widget_type: t })}>
                      {t === 'kpi' ? 'KPI' : WIDGET_LABEL[t]}
                    </button>
                  ))}
                </div>

                <div className="toggle-row" style={{ marginTop: 12 }}>
                  <span>Preview with live data<span className="sub">Renders against the real query as you edit</span></span>
                  <button className={`toggle${live ? ' on' : ''}`} role="switch" aria-checked={live}
                    aria-label="Preview with live data" onClick={() => setLive((v) => !v)} />
                </div>

                {selectedMeta.personalData && (
                  <div className="callout quiet">
                    <span className="ct">Personal data</span>
                    Employee performance is restricted: only dept heads, team leads, executives and
                    system admins can view widgets on this source — for everyone else the widget is hidden entirely.
                  </div>
                )}
                <div className="callout quiet">
                  <span className="ct">Runs under the viewer's permissions</span>
                  Every widget fetches through the live query path with the viewer's own RLS —
                  viewers see only rows their role and department scope allow. Nothing here can widen access.
                </div>

                <button className="btn ghost" style={{ width: '100%', justifyContent: 'center', marginTop: 12, color: 'var(--red)' }}
                  onClick={removeSelected}>
                  Remove widget
                </button>
              </>
            )}
          </div>
        </aside>
      </div>
    </section>
  )
}

function AddFilter({ onAdd }: { onAdd: (f: WidgetFilter) => void }) {
  const [open, setOpen] = useState(false)
  const [col, setCol] = useState('dept')
  const [op, setOp] = useState<'eq' | 'neq'>('eq')
  const [value, setValue] = useState('')
  if (!open) {
    return (
      <button className="btn" style={{ width: '100%', justifyContent: 'center', borderStyle: 'dashed' }} onClick={() => setOpen(true)}>
        + Add filter
      </button>
    )
  }
  return (
    <div className="tr" style={{ gap: 5 }}>
      <select className="input" style={{ maxWidth: 84, padding: '3px 6px', fontSize: 11 }} aria-label="Filter column"
        value={col} onChange={(e) => setCol(e.target.value)}>
        <option value="dept">dept</option>
        <option value="status">status</option>
        <option value="priority">priority</option>
      </select>
      <select className="input" style={{ maxWidth: 52, padding: '3px 6px', fontSize: 11 }} aria-label="Filter operator"
        value={op} onChange={(e) => setOp(e.target.value as 'eq' | 'neq')}>
        <option value="eq">=</option>
        <option value="neq">≠</option>
      </select>
      <input className="input" style={{ flex: 1, minWidth: 50, padding: '3px 6px', fontSize: 11 }} aria-label="Filter value"
        value={value} onChange={(e) => setValue(e.target.value)} placeholder="value" />
      <button className="x" aria-label="Confirm filter" style={{ color: 'var(--green)' }}
        onClick={() => { if (value.trim()) { onAdd({ col, op, value: value.trim() }); setValue(''); setOpen(false) } }}>✓</button>
      <button className="x" aria-label="Cancel filter" onClick={() => setOpen(false)}>×</button>
    </div>
  )
}

function MiniPreview({ widget, preview, liveOff }: {
  widget: WidgetDraft
  preview: PreviewState | undefined
  liveOff: boolean
}) {
  if (liveOff) return <div className="mini-hint">Live preview off</div>
  if (!preview || preview.status === 'loading') return <div className="mini-hint">Loading preview…</div>
  if (preview.status === 'na') {
    return <div className="mini-hint">No live preview for this chart type yet — it renders on the dashboard.</div>
  }
  if (preview.status === 'error') {
    return <div className="mini-hint" style={{ color: 'var(--red)' }}>Preview failed: {preview.message}</div>
  }

  const rows = preview.rows
  if (widget.widget_type === 'kpi') {
    const v = rows[0]?.value
    return <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}><span className="mini-kpi">{v === undefined || v === null ? '—' : String(v)}</span></div>
  }
  if (widget.widget_type === 'bar' || widget.widget_type === 'donut') {
    const top = rows.slice(0, 4)
    const max = Math.max(...top.map((r) => Number(r.value) || 0), 1)
    const groupKey = preview.columns[0]
    return (
      <svg width="100%" height={top.length * 20 + 6} viewBox={`0 0 230 ${top.length * 20 + 6}`} aria-label={`Preview: ${widget.title}`} preserveAspectRatio="xMinYMin meet">
        {top.map((r, i) => (
          <g key={i}>
            <text x={58} y={14 + i * 20} textAnchor="end" style={{ fontFamily: 'var(--font-body)', fontSize: 8, fill: 'var(--muted)' }}>
              {String(r[groupKey] ?? '—').slice(0, 12)}
            </text>
            <rect x={64} y={6 + i * 20} width={Math.max(4, (Number(r.value) / max) * 132)} height={11} rx={3}
              fill="var(--it)" opacity={i === 0 ? 1 : 0.55} />
          </g>
        ))}
      </svg>
    )
  }
  // table
  const cols = preview.columns.slice(0, 3)
  return (
    <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--font-mono)' }}>
      {rows.slice(0, 3).map((r, i) => (
        <div key={i} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {cols.map((c) => String(r[c] ?? '—')).join(' · ')}
        </div>
      ))}
      {rows.length === 0 && '(no rows)'}
    </div>
  )
}
