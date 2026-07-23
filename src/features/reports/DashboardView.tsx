/**
 * Generic renderer for a SAVED dashboard (report_dashboards/report_widgets —
 * builtin rows seeded by 00089 or boards published from the builder). Each
 * widget compiles its stored config through the same widgetToConfig the
 * builder previews with and fetches via query-live under the VIEWER's own
 * RLS — the migration's promise: the old builtin templates render as live
 * widgets, not a parallel library.
 */
import { useEffect, useRef, useState } from 'react'
import { Donut, HBarChart } from '../../components/charts'
import { previewSupported, widgetToConfig, type WidgetDraft } from './builderQuery'
import { getDashboardWidgets, type DashboardRow, type WidgetRow } from './dashboardsApi'
import { queryLive } from './queryLive'
import { asOfLabel } from './analyticsData'

const PALETTE = ['var(--it)', 'var(--green)', 'var(--amber)', 'var(--red)', '#AEB6C6', 'var(--admin)', 'var(--log)']

type WidgetData =
  | { status: 'loading' }
  | { status: 'ok'; rows: Record<string, unknown>[]; columns: string[] }
  | { status: 'error'; message: string }
  | { status: 'na' }

export function DashboardView({ board }: { board: DashboardRow }) {
  const [widgets, setWidgets] = useState<WidgetRow[]>([])
  const [data, setData] = useState<Record<string, WidgetData>>({})
  const [asOf, setAsOf] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const seq = useRef(0)

  useEffect(() => {
    const mySeq = ++seq.current
    setWidgets([]); setData({}); setError(null)
    getDashboardWidgets(board.id)
      .then((ws) => {
        if (mySeq !== seq.current) return
        setWidgets(ws)
        ws.forEach((w) => {
          const draft: WidgetDraft = {
            widget_type: w.widget_type, data_source: w.data_source,
            title: w.title, config: w.config as WidgetDraft['config'],
          }
          if (!previewSupported(w.widget_type)) {
            setData((d) => ({ ...d, [w.id]: { status: 'na' } }))
            return
          }
          setData((d) => ({ ...d, [w.id]: { status: 'loading' } }))
          queryLive(w.data_source, widgetToConfig(draft, new Date()))
            .then((res) => {
              if (mySeq !== seq.current) return
              setAsOf(res.as_of)
              setData((d) => ({ ...d, [w.id]: { status: 'ok', rows: res.rows, columns: res.columns } }))
            })
            .catch((e) => {
              if (mySeq !== seq.current) return
              setData((d) => ({ ...d, [w.id]: { status: 'error', message: (e as Error).message } }))
            })
        })
      })
      .catch((e) => { if (mySeq === seq.current) setError((e as Error).message) })
  }, [board.id])

  return (
    <div>
      {error && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <div className="widgets" style={{ marginBottom: 14 }}>
        {widgets.map((w) => (
          <SavedWidget key={w.id} widget={w} data={data[w.id]} />
        ))}
        {widgets.length === 0 && !error && (
          <div style={{ color: 'var(--muted)', fontSize: 13, padding: 20 }}>This dashboard has no widgets yet — add some in the builder.</div>
        )}
      </div>
      <div className="actionbar" role="toolbar" aria-label="Dashboard actions">
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>
          Widgets run their saved queries under your own access — edit them in the builder.
        </span>
        {asOf && <span className="asof">{asOfLabel(asOf, new Date())}</span>}
      </div>
    </div>
  )
}

function SavedWidget({ widget, data }: { widget: WidgetRow; data: WidgetData | undefined }) {
  const cfg = widget.config as { group_by?: string; period?: { preset?: string } }
  return (
    <article className="widget">
      <header className="w-head">
        <div>
          <div className="w-title">{widget.title}</div>
          <div className="w-sub">
            {widget.data_source}
            {cfg.group_by ? ` · by ${cfg.group_by}` : ''}
            {cfg.period?.preset === 'quarter' ? ' · last quarter' : cfg.period?.preset === 'last30' ? ' · last 30 days' : ''}
          </div>
        </div>
      </header>
      <div className="w-body">
        <WidgetBody widget={widget} data={data} />
      </div>
    </article>
  )
}

function WidgetBody({ widget, data }: { widget: WidgetRow; data: WidgetData | undefined }) {
  if (!data || data.status === 'loading') return <div className="mini-hint">Loading…</div>
  if (data.status === 'na') {
    return <div className="mini-hint">This chart type renders in a future update — open the widget in the builder to see its query.</div>
  }
  if (data.status === 'error') {
    return <div className="mini-hint" style={{ color: 'var(--red)' }}>Query failed: {data.message}</div>
  }

  const { rows, columns } = data
  if (widget.widget_type === 'kpi') {
    const v = rows[0]?.value
    return (
      <div style={{ padding: '10px 0 14px' }}>
        <span className="mini-kpi" style={{ fontSize: 32 }}>{v === undefined || v === null ? '—' : String(v)}</span>
      </div>
    )
  }
  if (widget.widget_type === 'bar') {
    const groupKey = columns[0]
    return (
      <HBarChart
        rows={rows.slice(0, 6).map((r, i) => ({
          label: String(r[groupKey] ?? '—'),
          value: Number(r.value) || 0,
          fill: PALETTE[i % PALETTE.length],
        }))}
        ariaLabel={`Bar chart: ${widget.title}`}
      />
    )
  }
  if (widget.widget_type === 'donut') {
    const groupKey = columns[0]
    const top = rows.slice(0, 6)
    const total = top.reduce((s, r) => s + (Number(r.value) || 0), 0)
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'center', paddingBottom: 6 }}>
        <Donut
          segments={top.map((r, i) => ({ value: Number(r.value) || 0, stroke: PALETTE[i % PALETTE.length] }))}
          centerValue={total}
          centerLabel={widget.data_source}
          ariaLabel={`Donut chart: ${widget.title}`}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7, fontSize: 11, color: 'var(--muted)' }}>
          {top.map((r, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <i style={{ width: 9, height: 9, borderRadius: 3, background: PALETTE[i % PALETTE.length], display: 'inline-block' }} />
              {String(r[groupKey] ?? '—')} <span className="mono" style={{ color: 'var(--ink)' }}>{String(r.value ?? 0)}</span>
            </span>
          ))}
        </div>
      </div>
    )
  }
  // table
  const cols = columns.slice(0, 6)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', fontSize: 11.5, width: '100%' }}>
        <thead>
          <tr>{cols.map((c) => (
            <th key={c} style={{ textAlign: 'start', padding: '5px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap', fontSize: 10, textTransform: 'uppercase', color: 'var(--muted)' }}>{c}</th>
          ))}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 8).map((r, i) => (
            <tr key={i}>{cols.map((c) => (
              <td key={c} style={{ padding: '5px 8px', borderBottom: '1px solid var(--surface)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                {String(r[c] ?? '—')}
              </td>
            ))}</tr>
          ))}
          {rows.length === 0 && <tr><td colSpan={cols.length} style={{ padding: 10, color: 'var(--muted)' }}>No rows.</td></tr>}
        </tbody>
      </table>
      {rows.length > 8 && <div className="mini-hint">{rows.length} rows — export for the full set.</div>}
    </div>
  )
}
