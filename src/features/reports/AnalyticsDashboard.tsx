/**
 * Zone 1 — the analytics dashboard (reference: prototype/reporting-rebuild-
 * reference.html). Curated dashboards with a run-time filter bar: every
 * filter change is one query-live fetch under the caller's own RLS — no
 * report_runs row, no artifact — and the widgets, KPI deltas and drill-down
 * subsets all derive client-side from that one result set. Filter state
 * lives in the URL so a filtered view is shareable.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Donut, HBarChart, LineChart, Sparkline, StackedColumns } from '../../components/charts'
import { SlaRing } from '../../components/SlaRing'
import { StatusChip } from '../../components/ui'
import {
  DEPT_FILL, DEPT_LABEL, OPEN_STATUSES, PERIOD_LABEL, STATUS_LABEL,
  asOfLabel, buildLiveConfig, dailySeries, deriveKpis, openByPriority, periodDays,
  segmentRows, splitWindow, volumeByService, weeklySla,
  type FilterState, type PeriodKey, type RequestRow, type Segment, type StatusKey,
} from './analyticsData'
import { useAuth } from '../auth/AuthProvider'
import { createSchedule, getRun, runReport, type Format, type ReportConfig, type ReportRun } from './api'
import { saveUrl } from './artifact'
import { CURATED_DASHBOARDS, dashboardBySlug } from './dashboards'
import { listDashboards, saveDashboard, type DashboardRow } from './dashboardsApi'
import { seedWidgets } from './DashboardBuilder'
import { DashboardView } from './DashboardView'
import { curatedSections, ensureExportDefinition, exportSubtitle } from './exportDashboard'
import { queryLive } from './queryLive'
import { EmailReportDialog, ScheduleDialog } from './reportDialogs'

const PRIORITY_META: Record<string, { label: string; fill: string }> = {
  P1: { label: 'P1 Critical', fill: 'var(--red)' },
  P2: { label: 'P2 High', fill: 'var(--amber)' },
  P3: { label: 'P3 Normal', fill: 'var(--it)' },
  P4: { label: 'P4 Low', fill: '#AEB6C6' },
}

const fmtDay = (d: Date) => `${d.getUTCDate()} ${d.toLocaleString('en', { month: 'short', timeZone: 'UTC' })}`

export function AnalyticsDashboard() {
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const { profile } = useAuth()
  const ownerId = profile?.id ?? ''

  // saved/builtin boards (00089 migrated the old templates here) share the
  // same picker as the curated overviews; picking one switches to the
  // generic widget renderer
  const [dbBoards, setDbBoards] = useState<DashboardRow[]>([])
  useEffect(() => { listDashboards().then(setDbBoards).catch(() => {}) }, [])
  const dbBoard = dbBoards.find((b) => b.slug === params.get('dash')) ?? null
  const isCurated = !dbBoard || CURATED_DASHBOARDS.some((d) => d.slug === params.get('dash'))

  // ---- filter state: the URL is the source of truth ----
  const dash = dashboardBySlug(params.get('dash'))
  const filters: FilterState = useMemo(() => ({
    dash: dash.slug,
    period: (['last7', 'last30', 'quarter', 'ytd'].includes(params.get('period') ?? '') ? params.get('period') : 'last30') as PeriodKey,
    dept: params.get('dept') ?? dash.dept,
    priority: params.get('priority') ?? 'ALL',
    status: (['all', 'open', 'resolved', 'closed'].includes(params.get('status') ?? '') ? params.get('status') : 'all') as StatusKey,
  }), [params, dash])

  const setFilter = (patch: Partial<FilterState>) => {
    const next = new URLSearchParams(params)
    next.set('tab', 'analytics')
    const merged = { ...filters, ...patch }
    // switching dashboards re-scopes the department default
    if (patch.dash) merged.dept = dashboardBySlug(patch.dash).dept
    next.set('dash', merged.dash)
    next.set('period', merged.period)
    next.set('dept', merged.dept)
    next.set('priority', merged.priority)
    next.set('status', merged.status)
    setParams(next, { replace: true })
    setDrill(null)
  }

  // ---- one live fetch per filter state ----
  const [rows, setRows] = useState<RequestRow[]>([])
  const [asOf, setAsOf] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [drill, setDrill] = useState<Segment | null>(null)
  // ---- action bar: export/email/schedule through the v1 engine ----
  const [actionBusy, setActionBusy] = useState<string | null>(null)
  const [actionNote, setActionNote] = useState<string | null>(null)
  const [emailRun, setEmailRun] = useState<ReportRun | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const fetchSeq = useRef(0)
  const now = useMemo(() => new Date(), [rows]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!isCurated) return // a saved board's widgets fetch for themselves
    const seq = ++fetchSeq.current
    setLoading(true); setError(null)
    queryLive('requests', buildLiveConfig(filters, new Date()))
      .then((res) => {
        if (seq !== fetchSeq.current) return
        setRows(res.rows as unknown as RequestRow[])
        setAsOf(res.as_of)
      })
      .catch((e) => { if (seq === fetchSeq.current) setError((e as Error).message) })
      .finally(() => { if (seq === fetchSeq.current) setLoading(false) })
  }, [filters, isCurated])

  // ---- derivations (all client-side, all from the one fetch) ----
  const days = periodDays(filters.period, now)
  const { current, previous } = useMemo(() => splitWindow(rows, now, days), [rows, now, days])
  const kpis = useMemo(() => deriveKpis(current, previous), [current, previous])
  const daily = useMemo(() => dailySeries(current, days, now), [current, days, now])
  const services = useMemo(() => volumeByService(current), [current])
  const priorities = useMemo(() => openByPriority(current), [current])
  const weeks = useMemo(() => weeklySla(current, now), [current, now])
  const drillRows = useMemo(
    () => (drill ? segmentRows(current, drill, now, days) : []),
    [drill, current, now, days])

  const yMaxDaily = Math.max(8, ...daily.created, ...daily.resolved)
  const lineYMax = Math.ceil(yMaxDaily / 3) * 3
  const weekMax = Math.max(...weeks.map((w) => w.met + w.breached), 1)
  const weekYMax = Math.max(10, Math.ceil(weekMax / 10) * 10)
  const totalOpen = priorities.reduce((s, p) => s + p.value, 0)
  const midDay = new Date(now.getTime() - Math.round(days / 2) * 86_400_000)
  const startDay = new Date(now.getTime() - (days - 1) * 86_400_000)

  const drillIndex = drill?.kind === 'service'
    ? services.findIndex((s) => s.code === drill.code && s.dept === drill.dept)
    : null

  const exportDef = () => ensureExportDefinition({
    slugKey: dash.slug,
    name: dash.name,
    description: exportSubtitle(dash, filters),
    sections: curatedSections(filters, new Date()),
    ownerId,
  })

  const doExport = async (fmt: Format) => {
    setActionBusy(fmt); setActionNote(null)
    try {
      const def = await exportDef()
      const res = await runReport(def, ownerId, fmt)
      if (res.error) setActionNote(res.error)
      else if (res.downloadUrl) saveUrl(res.downloadUrl, `${def.slug}.${fmt}`)
    } catch (e) { setActionNote((e as Error).message) }
    finally { setActionBusy(null) }
  }

  const doEmail = async () => {
    setActionBusy('email'); setActionNote(null)
    try {
      const def = await exportDef()
      const res = await runReport(def, ownerId, 'pdf', 'email')
      if (res.error) { setActionNote(res.error); return }
      const run = await getRun(res.runId)
      if (run) setEmailRun(run)
      else setActionNote('The export ran but its run row is not visible yet — try again.')
    } catch (e) { setActionNote((e as Error).message) }
    finally { setActionBusy(null) }
  }

  const doSaveView = async () => {
    setActionBusy('save'); setActionNote(null)
    try {
      const suffix = [PERIOD_LABEL[filters.period], filters.dept !== 'ALL' ? filters.dept : null].filter(Boolean).join(' · ')
      await saveDashboard({
        name: `${dash.name} — ${suffix}`, visibility: 'private', deptId: null, ownerId,
        widgets: seedWidgets(filters.dept),
      })
      setActionNote('View saved — open it from the builder’s "Open saved…" list.')
    } catch (e) { setActionNote((e as Error).message) }
    finally { setActionBusy(null) }
  }

  const appliedChips: { k: string; label: string; clear: () => void }[] = []
  appliedChips.push({ k: 'period', label: PERIOD_LABEL[filters.period], clear: () => setFilter({ period: 'last30' }) })
  if (filters.dept !== 'ALL') appliedChips.push({ k: 'dept', label: filters.dept, clear: () => setFilter({ dept: 'ALL' }) })
  if (filters.priority !== 'ALL') appliedChips.push({ k: 'priority', label: filters.priority, clear: () => setFilter({ priority: 'ALL' }) })
  appliedChips.push(filters.status === 'all'
    ? { k: 'status', label: '≠ Cancelled', clear: () => setFilter({ status: 'all' }) }
    : { k: 'status', label: STATUS_LABEL[filters.status], clear: () => setFilter({ status: 'all' }) })

  const pickBoard = (slug: string) => {
    if (CURATED_DASHBOARDS.some((d) => d.slug === slug)) { setFilter({ dash: slug }); return }
    const next = new URLSearchParams(params)
    next.set('tab', 'analytics')
    next.set('dash', slug)
    setParams(next, { replace: true })
    setDrill(null)
  }
  const picker = (
    <select
      className="input" style={{ maxWidth: 250 }} aria-label="Dashboard"
      value={isCurated ? dash.slug : dbBoard!.slug} onChange={(e) => pickBoard(e.target.value)}
    >
      <optgroup label="Curated overviews">
        {CURATED_DASHBOARDS.map((d) => <option key={d.slug} value={d.slug}>{d.name}</option>)}
      </optgroup>
      {dbBoards.length > 0 && (
        <optgroup label="Saved & builtin dashboards">
          {dbBoards.map((b) => <option key={b.slug} value={b.slug}>{b.name}</option>)}
        </optgroup>
      )}
    </select>
  )

  // a saved/builtin board renders through the generic widget renderer —
  // its widgets carry their own queries (still the viewer's RLS)
  if (!isCurated && dbBoard) {
    return (
      <section aria-label={`Analytics — ${dbBoard.name}`}>
        <div className="builder-bar">
          <h2>Analytics</h2>
          {picker}
          <span className="scope-badge scope-dept">
            {dbBoard.kind === 'builtin' ? 'Builtin · org-wide' : `Custom · ${dbBoard.visibility}`}
          </span>
          <span className="tool-spacer" style={{ flex: 1 }} />
          <button
            className="btn"
            onClick={() => {
              const next = new URLSearchParams(params)
              next.set('tab', 'builder')
              setParams(next)
            }}
          >
            Open in builder
          </button>
        </div>
        <DashboardView board={dbBoard} />
      </section>
    )
  }

  return (
    <section aria-label={`Analytics — ${dash.name}`} aria-busy={loading}>
      <div className="builder-bar">
        <h2>Analytics</h2>
        {picker}
        <span className="scope-badge scope-dept">{dash.scopeLabel}</span>
        <span className="tool-spacer" style={{ flex: 1 }} />
        <button
          className="btn ghost"
          title="Copy this dashboard's widgets into a new draft you own"
          onClick={() => {
            const next = new URLSearchParams(params)
            next.set('tab', 'builder')
            next.set('seed', dash.slug)
            setParams(next)
          }}
        >
          Duplicate to edit
        </button>
        <button
          className="btn"
          onClick={() => {
            const next = new URLSearchParams(params)
            next.set('tab', 'builder')
            setParams(next)
          }}
        >
          Open in builder
        </button>
      </div>

      {/* run-time filter bar */}
      <div className="filterbar" role="group" aria-label="Run-time filters">
        <div className="f-row">
          <FilterSelect label="Period" value={filters.period} onChange={(v) => setFilter({ period: v as PeriodKey })}
            options={Object.entries(PERIOD_LABEL)} />
          <FilterSelect label="Department" value={filters.dept} onChange={(v) => setFilter({ dept: v })}
            options={Object.entries(DEPT_LABEL)} />
          <FilterSelect label="Priority" value={filters.priority} onChange={(v) => setFilter({ priority: v })}
            options={[['ALL', 'All'], ...Object.entries(PRIORITY_META).map(([k, m]) => [k, m.label] as [string, string])]} />
          <FilterSelect label="Status" value={filters.status} onChange={(v) => setFilter({ status: v as StatusKey })}
            options={Object.entries(STATUS_LABEL)} />
        </div>
        <div className="f-applied">
          <span className="lbl">Applied:</span>
          {appliedChips.map((c) => (
            <span key={c.k} className="fchip">
              <span className="k">{c.k}</span>{c.label}
              <button className="x" aria-label={`Remove filter: ${c.k} ${c.label}`} onClick={c.clear}>×</button>
            </span>
          ))}
          <span className="f-note">{loading ? 'Refreshing…' : 'Filters apply instantly — no re-run'}</span>
        </div>
      </div>

      {error && (
        <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>
          Live query failed: {error}
        </div>
      )}

      {/* KPI row */}
      <div className="kpis">
        <Kpi label="Open requests" value={String(kpis.open)}
          delta={kpis.openDelta} deltaTone={kpis.openDelta > 0 ? 'up' : 'down'}
          sub={`vs previous ${days} days`} spark={daily.created} sparkStroke="var(--it)" />
        <Kpi label="SLA compliance" value={kpis.slaPct === null ? '—' : String(kpis.slaPct)} unit={kpis.slaPct === null ? undefined : '%'}
          delta={kpis.slaPctDelta} deltaTone={(kpis.slaPctDelta ?? 0) >= 0 ? 'good' : 'down'}
          sub="resolution SLA · met vs due" spark={daily.resolved} sparkStroke="var(--green)" />
        <Kpi label="Avg resolution" value={kpis.avgResolutionHours === null ? '—' : String(kpis.avgResolutionHours)} unit={kpis.avgResolutionHours === null ? undefined : 'h'}
          delta={kpis.avgResolutionDelta} deltaTone={(kpis.avgResolutionDelta ?? 0) <= 0 ? 'good' : 'down'}
          sub="business hours, Sun–Thu" spark={daily.resolved} sparkStroke="var(--green)" />
        <Kpi label="Breaches" value={String(kpis.breaches)}
          delta={kpis.breachesDelta} deltaTone={kpis.breachesDelta <= 0 ? 'good' : 'down'}
          sub="resolution SLA breaches" spark={daily.created} sparkStroke="var(--red)" />
      </div>

      {/* widget grid + drill-down slide-over */}
      <div className={`dash${drill ? '' : ' nodrill'}`}>
        <div className="widgets">
          <article className="widget">
            <header className="w-head">
              <div>
                <div className="w-title">Requests created vs resolved</div>
                <div className="w-sub">daily · {PERIOD_LABEL[filters.period].toLowerCase()}</div>
              </div>
              <button className="kebab" aria-label="Widget menu: Requests created vs resolved"><i /></button>
            </header>
            <div className="w-body">
              <LineChart
                series={[
                  { values: daily.created, stroke: 'var(--it)', area: true },
                  { values: daily.resolved, stroke: 'var(--green)' },
                ]}
                yMax={lineYMax}
                xLabels={{ start: fmtDay(startDay), mid: fmtDay(midDay), end: fmtDay(now) }}
                ariaLabel={`Line chart, requests created versus resolved per day, ${PERIOD_LABEL[filters.period]}`}
                onPointClick={(si, pi) => setDrill({
                  kind: 'day', index: pi, series: si === 0 ? 'created' : 'resolved',
                  label: `${si === 0 ? 'Created' : 'Resolved'} · day ${pi + 1}`,
                })}
              />
            </div>
            <footer className="w-legend">
              <span className="lg"><i className="ln" style={{ borderColor: 'var(--it)' }} />Created</span>
              <span className="lg"><i className="ln" style={{ borderColor: 'var(--green)' }} />Resolved</span>
            </footer>
            <span className="w-hint">Click a point to drill down</span>
          </article>

          <article className={`widget${drill?.kind === 'service' ? ' drilled' : ''}`}>
            <header className="w-head">
              <div>
                <div className="w-title">Volume by service</div>
                <div className="w-sub">top {services.length || 6} · count of requests</div>
              </div>
              {drill?.kind === 'service' && <span className="chip t-accent" style={{ fontSize: 9.5 }}>1 segment selected</span>}
              <button className="kebab" aria-label="Widget menu: Volume by service"><i /></button>
            </header>
            <div className="w-body">
              <HBarChart
                rows={services.map((s) => ({
                  label: `${s.dept}-${s.code} ${s.name}`,
                  value: s.value,
                  fill: DEPT_FILL[s.dept] ?? 'var(--it)',
                }))}
                selectedIndex={drillIndex === -1 ? null : drillIndex}
                ariaLabel="Horizontal bar chart, request volume by service"
                onBarClick={(i) => {
                  const s = services[i]
                  if (s) setDrill({ kind: 'service', code: s.code, dept: s.dept, label: `${s.dept}-${s.code} ${s.name}` })
                }}
              />
            </div>
            <footer className="w-legend">
              <span className="lg"><i style={{ background: 'var(--it)' }} />IT</span>
              <span className="lg"><i style={{ background: 'var(--admin)' }} />Administration</span>
              <span className="lg"><i style={{ background: 'var(--log)' }} />Logistics</span>
            </footer>
            <span className="w-hint">
              {drill?.kind === 'service' ? `Drilled: ${drill.label} — ${drillRows.length} records` : 'Click a bar to drill down'}
            </span>
          </article>

          <article className={`widget${drill?.kind === 'priority' ? ' drilled' : ''}`}>
            <header className="w-head">
              <div>
                <div className="w-title">By priority</div>
                <div className="w-sub">open requests</div>
              </div>
              <button className="kebab" aria-label="Widget menu: By priority"><i /></button>
            </header>
            <div className="w-body" style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center', paddingBottom: 6 }}>
              <Donut
                segments={priorities.map((p) => ({ value: p.value, stroke: PRIORITY_META[p.priority].fill }))}
                centerValue={totalOpen}
                centerLabel="open requests"
                ariaLabel={`Donut chart, ${totalOpen} open requests by priority`}
                onSegmentClick={(i) => {
                  const p = priorities[i]
                  if (p) setDrill({ kind: 'priority', priority: p.priority, label: PRIORITY_META[p.priority].label })
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11, color: 'var(--muted)' }}>
                {priorities.map((p) => (
                  <span key={p.priority} className="lg" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <i style={{ width: 9, height: 9, borderRadius: 3, background: PRIORITY_META[p.priority].fill, display: 'inline-block' }} />
                    {PRIORITY_META[p.priority].label} <span className="mono" style={{ color: 'var(--ink)' }}>{p.value}</span>
                  </span>
                ))}
              </div>
            </div>
            <span className="w-hint">Click a segment to drill down</span>
          </article>

          <article className={`widget${drill?.kind === 'week' ? ' drilled' : ''}`}>
            <header className="w-head">
              <div>
                <div className="w-title">SLA met vs breached</div>
                <div className="w-sub">by week · resolution SLA</div>
              </div>
              <button className="kebab" aria-label="Widget menu: SLA met vs breached"><i /></button>
            </header>
            <div className="w-body">
              <StackedColumns
                columns={weeks.map((w) => ({ label: w.label, met: w.met, breached: w.breached, partial: w.partial }))}
                yMax={weekYMax}
                ariaLabel="Stacked column chart, SLA met versus breached per week"
                onSegmentClick={(i) => {
                  const w = weeks[i]
                  if (w) setDrill({ kind: 'week', start: w.start, label: `Week of ${w.label.replace('*', '')}` })
                }}
              />
            </div>
            <footer className="w-legend">
              <span className="lg"><i style={{ background: 'var(--green)' }} />Met</span>
              <span className="lg"><i style={{ background: 'var(--red)' }} />Breached</span>
              <span style={{ marginInlineStart: 'auto' }}>* week in progress</span>
            </footer>
            <span className="w-hint">Click a segment to drill down</span>
          </article>
        </div>

        {drill && (
          <aside className="drill" aria-label="Underlying records">
            <div className="drill-head">
              <div className="t">
                <h3>Underlying records — {drillRows.length}</h3>
                <button className="x" aria-label="Close underlying records panel" onClick={() => setDrill(null)}>×</button>
              </div>
              <div className="drill-path">
                <span>{drill.kind === 'service' ? 'Volume by service' : drill.kind === 'priority' ? 'By priority' : drill.kind === 'week' ? 'SLA met vs breached' : 'Created vs resolved'}</span>
                <span aria-hidden="true">›</span>
                <span className="seg-chip hi">{drill.label}</span>
                <span className="seg-chip">{PERIOD_LABEL[filters.period]}</span>
                {filters.dept !== 'ALL' && <span className="seg-chip">{filters.dept}</span>}
              </div>
            </div>

            {drillRows.slice(0, 8).map((r) => (
              <button key={r.ref} className="rec" onClick={() => nav(`/requests/${r.ref}`)}>
                <span className="ring"><SlaRing createdAt={r.created_at} due={r.sla_resolution_due} /></span>
                <span>
                  <span className="rid">{r.ref}</span>
                  <span className="rsum" style={{ display: 'block' }}>{r.title}</span>
                </span>
                <StatusChip status={r.status} />
              </button>
            ))}
            {drillRows.length === 0 && (
              <div style={{ padding: '16px 14px', fontSize: 12, color: 'var(--muted)' }}>No records in this segment.</div>
            )}

            <div className="drill-foot">
              <span className="drill-more">
                {Math.min(8, drillRows.length)} of {drillRows.length} shown — same rows, same RLS as the queue
              </span>
              <button className="btn" style={{ justifyContent: 'center' }} onClick={() => nav('/work?view=queue')}>
                View in Work queue →
              </button>
            </div>
          </aside>
        )}
      </div>

      {/* action bar — exports run through the v1 engine with the CURRENT filters */}
      <div className="actionbar" role="toolbar" aria-label="Dashboard actions">
        <button className="btn" disabled={!!actionBusy} onClick={() => doExport('pdf')}>
          {actionBusy === 'pdf' ? 'Exporting…' : 'Export PDF'}
        </button>
        <button className="btn" disabled={!!actionBusy} onClick={() => doExport('xlsx')}>
          {actionBusy === 'xlsx' ? 'Exporting…' : 'Export XLSX'}
        </button>
        <span className="a-sep" role="presentation" />
        <button className="btn" disabled={!!actionBusy} onClick={doEmail}>
          {actionBusy === 'email' ? 'Preparing…' : 'Email'}
        </button>
        <button className="btn" disabled={!!actionBusy} onClick={() => setShowSchedule(true)}>Schedule</button>
        <span className="a-sep" role="presentation" />
        <button className="btn primary" disabled={!!actionBusy} onClick={doSaveView}>
          {actionBusy === 'save' ? 'Saving…' : 'Save view'}
        </button>
        {asOf && <span className="asof">{asOfLabel(asOf, now)}</span>}
      </div>
      {actionNote && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 8 }}>{actionNote}</div>
      )}

      {emailRun && <EmailReportDialog run={emailRun} onClose={() => setEmailRun(null)} />}
      {showSchedule && (
        <ScheduleDialog
          formats={['pdf', 'xlsx']}
          onClose={() => setShowSchedule(false)}
          onCreate={async (cadence, timezone, format) => {
            const def = await exportDef()
            // freeze the CURRENT dashboard as sections — the dispatcher copies
            // this into run.params, which generate-report merges over the
            // definition (params win), so a later export click that rewrites
            // the shared definition can't change what the schedule delivers
            await createSchedule({
              definitionId: def.id, cadence, timezone, format, ownerId, recipients: {},
              filtersSnapshot: { sections: curatedSections(filters, new Date()) } as unknown as ReportConfig,
            })
            setShowSchedule(false)
            setActionNote('Scheduled — manage it under Exports & schedules.')
          }}
        />
      )}
    </section>
  )
}

function FilterSelect({ label, value, options, onChange }: {
  label: string
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  const id = `fl-${label.toLowerCase().replace(/[^a-z]/g, '')}`
  return (
    <div className="f-group">
      <span className="f-lbl" id={id}>{label}</span>
      <select className="input" aria-labelledby={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
      </select>
    </div>
  )
}

function Kpi({ label, value, unit, delta, deltaTone, sub, spark, sparkStroke }: {
  label: string
  value: string
  unit?: string
  delta: number | null
  deltaTone: 'up' | 'down' | 'good'
  sub: string
  spark: number[]
  sparkStroke: string
}) {
  return (
    <div className="kpi">
      <span className="k-lbl">{label}</span>
      <div className="k-row">
        <span className="k-val">{value}{unit && <span className="k-unit">{unit}</span>}</span>
        {delta !== null && delta !== 0 && (
          <span className={`delta ${deltaTone}`}>{delta > 0 ? '▲' : '▼'} {Math.abs(delta)}</span>
        )}
      </div>
      <div className="k-foot">
        <span className="k-sub">{sub}</span>
        <Sparkline values={spark.length > 1 ? spark : [0, 0]} stroke={sparkStroke} />
      </div>
    </div>
  )
}
