import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../auth/AuthProvider'
import { AnalyticsDashboard } from './AnalyticsDashboard'
import { DashboardBuilder } from './DashboardBuilder'
import './reports.css'
import {
  artifactSignedUrl, createSchedule, deleteSchedule, emailReport, listDefinitions, listRuns, listSchedules,
  previewReport, runReport, setScheduleEnabled,
  type Format, type Preview, type ReportDefinition, type ReportRun, type ReportSchedule,
} from './api'
import { artifactFilename, previewable, saveUrl } from './artifact'
import { cadenceToCron, describeCadence, WEEKDAYS, type Preset } from './cron'

const SOURCE_LABEL: Record<string, string> = {
  requests: 'Requests', sla: 'SLA', assets: 'Assets', letters: 'Correspondence',
  pmo_projects: 'Projects', dept_performance: 'Dept performance', employee_performance: 'Employee performance',
}
const STATUS_TONE: Record<string, { bg: string; fg: string }> = {
  queued: { bg: 'var(--surface)', fg: 'var(--muted)' },
  running: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
  succeeded: { bg: 'var(--green-soft, #e7f6ec)', fg: 'var(--green, #1a7f43)' },
  failed: { bg: 'var(--red-soft)', fg: 'var(--red)' },
}
const fmtTime = (s: string | null) => (s ? new Date(s).toLocaleString() : '—')

function Tag({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'accent' | 'red' }) {
  const map = {
    muted: { bg: 'var(--surface)', fg: 'var(--muted)' },
    accent: { bg: 'var(--accent-soft)', fg: 'var(--accent)' },
    red: { bg: 'var(--red-soft)', fg: 'var(--red)' },
  }[tone]
  return (
    <span style={{ background: map.bg, color: map.fg, borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 600 }}>
      {children}
    </span>
  )
}

/**
 * Reports landing (Reporting Rebuild v2): the analytics dashboard IS the
 * page — the zone tabs from the reference switch between it and the
 * exportable/scheduled documents that keep using the v1 engine. Zone 2
 * (the dashboard builder) arrives on its own branch.
 */
export function Reports() {
  const [params, setParams] = useSearchParams()
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const rawTab = params.get('tab')
  const tab = rawTab === 'exports' ? 'exports' : rawTab === 'builder' ? 'builder' : 'analytics'

  useEffect(() => {
    supabase.from('feature_flags').select('is_enabled').eq('key', 'reporting').maybeSingle()
      .then(({ data }) => setEnabled(Boolean((data as { is_enabled?: boolean } | null)?.is_enabled)))
  }, [])

  if (enabled === false) {
    return (
      <div style={{ padding: 32 }}>
        <h1 style={{ marginTop: 0 }}>Reports</h1>
        <div style={{ background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 24, maxWidth: 560 }}>
          <b>Reporting is not enabled yet.</b>
          <p style={{ color: 'var(--muted)', marginBottom: 0 }}>
            An administrator can turn on the <span className="mono">reporting</span> feature flag in the Admin console to open the analytics dashboards.
          </p>
        </div>
      </div>
    )
  }

  const switchTab = (t: 'analytics' | 'builder' | 'exports') => {
    const next = new URLSearchParams(params)
    next.set('tab', t)
    setParams(next, { replace: true })
  }

  return (
    <div style={{ padding: '18px 32px 28px' }}>
      <div className="zonebar first" role="tablist" aria-label="Reporting sections">
        <button className={`ztab${tab === 'analytics' ? ' on' : ''}`} role="tab" aria-selected={tab === 'analytics'} onClick={() => switchTab('analytics')}>
          <span className="zk">01</span>Analytics
        </button>
        <button className={`ztab${tab === 'builder' ? ' on' : ''}`} role="tab" aria-selected={tab === 'builder'} onClick={() => switchTab('builder')}>
          <span className="zk">02</span>Report builder
        </button>
        <button className={`ztab${tab === 'exports' ? ' on' : ''}`} role="tab" aria-selected={tab === 'exports'} onClick={() => switchTab('exports')}>
          <span className="zk">03</span>Exports &amp; schedules
        </button>
        <span className="zone-note">
          {tab === 'analytics' ? 'Landing view — curated dashboards, filterable at run time'
            : tab === 'builder' ? 'Ad-hoc, zero-code — same three-pane pattern as the form and workflow builders'
            : 'Exportable & scheduled documents — v1 engine, owner-RLS'}
        </span>
      </div>
      {tab === 'analytics' ? <AnalyticsDashboard /> : tab === 'builder' ? <DashboardBuilder /> : <ReportsLibrary />}
    </div>
  )
}

/** Zone 3 — the exportable/scheduled documents (the v1 report library). */
function ReportsLibrary() {
  const { profile } = useAuth()
  const ownerId = profile?.id ?? ''
  const [defs, setDefs] = useState<ReportDefinition[]>([])
  const [selId, setSelId] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    listDefinitions().then((d) => {
      setDefs(d)
      setSelId((cur) => cur ?? d[0]?.id ?? null)
    }).catch((e) => setErr(e.message))
  }, [])

  const sel = useMemo(() => defs.find((d) => d.id === selId) ?? null, [defs, selId])
  const builtins = defs.filter((d) => d.kind === 'builtin')
  const saved = defs.filter((d) => d.kind === 'custom')

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 20, alignItems: 'start' }}>
      <div>
        <p style={{ color: 'var(--muted)', margin: '0 0 16px', fontSize: 13 }}>Run, download, email, and schedule reports — always under your own access.</p>
        {err && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 12 }}>{err}</div>}
        <Library title="Built-in" defs={builtins} selId={selId} onSelect={setSelId} />
        <Library title="Saved" defs={saved} selId={selId} onSelect={setSelId} />
        {defs.length === 0 && <div style={{ color: 'var(--muted)', fontSize: 13 }}>No reports available to you yet.</div>}
      </div>
      {sel ? <ReportPanel key={sel.id} def={sel} ownerId={ownerId} /> : <div />}
    </div>
  )
}

function Library({ title, defs, selId, onSelect }: {
  title: string; defs: ReportDefinition[]; selId: string | null; onSelect: (id: string) => void
}) {
  if (defs.length === 0) return null
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 8px' }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {defs.map((d) => (
          <button
            key={d.id}
            onClick={() => onSelect(d.id)}
            style={{
              textAlign: 'left', border: '1px solid var(--line)', borderRadius: 10, padding: '10px 12px', cursor: 'pointer',
              background: selId === d.id ? 'var(--accent-soft)' : 'var(--card, #fff)',
              borderColor: selId === d.id ? 'var(--accent)' : 'var(--line)',
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 13 }}>{d.name}</div>
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              <Tag>{SOURCE_LABEL[d.data_source] ?? d.data_source}</Tag>
              {d.contains_personal_data && <Tag tone="red">Personal data</Tag>}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ReportPanel({ def, ownerId }: { def: ReportDefinition; ownerId: string }) {
  const [runs, setRuns] = useState<ReportRun[]>([])
  const [schedules, setSchedules] = useState<ReportSchedule[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [showSchedule, setShowSchedule] = useState(false)
  const [showEmail, setShowEmail] = useState<ReportRun | null>(null)
  const [showView, setShowView] = useState<ReportRun | null>(null)

  const refresh = () => {
    listRuns(def.id).then(setRuns).catch(() => {})
    listSchedules(def.id).then(setSchedules).catch(() => {})
  }
  useEffect(refresh, [def.id])

  const formats: Format[] = (def.output_formats?.length ? def.output_formats : ['pdf', 'csv', 'xlsx']) as Format[]

  const doPreview = async () => {
    setBusy('preview'); setNote(null)
    try { setPreview(await previewReport(def, ownerId)) }
    catch (e) { setNote((e as Error).message) }
    finally { setBusy(null); refresh() }
  }
  const doDownload = async (fmt: Format) => {
    setBusy(fmt); setNote(null)
    try {
      const res = await runReport(def, ownerId, fmt)
      if (res.error) setNote(res.error)
      // programmatic anchor click — window.open after an await gets popup-blocked
      else if (res.downloadUrl) saveUrl(res.downloadUrl, `${def.slug}.${fmt}`)
    } catch (e) { setNote((e as Error).message) }
    finally { setBusy(null); refresh() }
  }

  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{def.name}</h2>
          {def.description && <p style={{ color: 'var(--muted)', margin: 0, fontSize: 13 }}>{def.description}</p>}
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <Tag tone="accent">{SOURCE_LABEL[def.data_source] ?? def.data_source}</Tag>
            <Tag>{def.visibility}</Tag>
            {def.contains_personal_data && <Tag tone="red">Personal data</Tag>}
          </div>
        </div>
      </div>

      <div style={{ background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 8, padding: '8px 12px', fontSize: 12, margin: '14px 0' }}>
        This report runs under <b>your own access</b> — you will only ever see rows you are allowed to see.
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
        <button className="btn" onClick={doPreview} disabled={!!busy}>{busy === 'preview' ? 'Running…' : 'Run preview'}</button>
        {formats.map((f) => (
          <button key={f} className="btn ghost" onClick={() => doDownload(f)} disabled={!!busy}>
            {busy === f ? '…' : `Download ${f.toUpperCase()}`}
          </button>
        ))}
        <button className="btn ghost" onClick={() => setShowSchedule(true)} disabled={!!busy}>Schedule</button>
      </div>
      {note && <div style={{ color: 'var(--red)', fontSize: 13, marginBottom: 8 }}>{note}</div>}

      {preview && (
        <div style={{ border: '1px solid var(--line)', borderRadius: 12, padding: 14, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 16, marginBottom: 10 }}>
            <div><div style={{ fontSize: 22, fontWeight: 700 }}>{preview.rowCount}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>rows</div></div>
            <div><div style={{ fontSize: 22, fontWeight: 700 }}>{preview.columns.length}</div><div style={{ fontSize: 11, color: 'var(--muted)' }}>columns</div></div>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>
              <thead><tr>{preview.columns.map((c) => (
                <th key={c} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', whiteSpace: 'nowrap' }}>{c}</th>
              ))}</tr></thead>
              <tbody>{preview.rows.map((r, i) => (
                <tr key={i}>{r.map((v, j) => <td key={j} style={{ padding: '5px 8px', borderBottom: '1px solid var(--surface)' }}>{v}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
          {preview.rowCount > preview.rows.length && (
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 8 }}>Showing the first {preview.rows.length} of {preview.rowCount} rows — download for the full report.</div>
          )}
        </div>
      )}

      <Section title="Run history">
        {runs.length === 0 ? <Empty>No runs yet.</Empty> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <tbody>{runs.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--surface)' }}>
                <td style={{ padding: '7px 4px' }}>
                  <span style={{ background: STATUS_TONE[r.status].bg, color: STATUS_TONE[r.status].fg, borderRadius: 6, padding: '2px 8px', fontWeight: 600 }}>{r.status}</span>
                </td>
                <td style={{ padding: '7px 8px', textTransform: 'uppercase', color: 'var(--muted)' }}>{r.format}</td>
                <td style={{ padding: '7px 8px' }}>{r.row_count ?? '—'} rows</td>
                <td style={{ padding: '7px 8px', color: 'var(--muted)' }}>{fmtTime(r.created_at)}</td>
                <td style={{ padding: '7px 4px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {r.status === 'succeeded' && r.artifact_path && (
                    <>
                      <button className="btn ghost sm" onClick={() => setShowView(r)}>View</button>{' '}
                      <button className="btn ghost sm" onClick={async () => {
                        try { saveUrl(await artifactSignedUrl(r.artifact_path!), artifactFilename(r.artifact_path!)) }
                        catch (e) { setNote((e as Error).message) }
                      }}>Download</button>{' '}
                      <button className="btn ghost sm" onClick={() => setShowEmail(r)}>Email once</button>
                    </>
                  )}
                  {r.status === 'failed' && r.error && <span style={{ color: 'var(--red)' }} title={r.error}>failed</span>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </Section>

      <Section title="Schedules">
        {schedules.length === 0 ? <Empty>No schedules.</Empty> : schedules.map((s) => (
          <div key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid var(--surface)', fontSize: 13 }}>
            <div>
              <b>{describeCadence(s.cadence)}</b> · <span style={{ textTransform: 'uppercase', color: 'var(--muted)' }}>{s.format}</span>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>{s.timezone} · next {fmtTime(s.next_run_at)}</div>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn ghost sm" onClick={() => setScheduleEnabled(s.id, !s.enabled).then(refresh)}>{s.enabled ? 'Pause' : 'Resume'}</button>
              <button className="btn ghost sm" onClick={() => deleteSchedule(s.id).then(refresh)}>Delete</button>
            </div>
          </div>
        ))}
      </Section>

      {showSchedule && (
        <ScheduleDialog
          formats={formats}
          onClose={() => setShowSchedule(false)}
          onCreate={async (cadence, timezone, format) => {
            await createSchedule({ definitionId: def.id, cadence, timezone, format, ownerId, recipients: {} })
            setShowSchedule(false); refresh()
          }}
        />
      )}
      {showEmail && (
        <EmailReportDialog run={showEmail} onClose={() => setShowEmail(null)} />
      )}
      {showView && (
        <ArtifactViewer run={showView} title={def.name} onClose={() => setShowView(null)} />
      )}
    </div>
  )
}

/** Inline viewer for a finished artifact — see the report exactly as delivered. */
function ArtifactViewer({ run, title, onClose }: { run: ReportRun; title: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (!run.artifact_path) { setErr('no artifact stored for this run'); return }
    artifactSignedUrl(run.artifact_path).then(setUrl).catch((e) => setErr((e as Error).message))
  }, [run])

  const canInline = previewable(run.format)
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,28,.5)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ background: 'var(--card, #fff)', borderRadius: 14, padding: 16, width: 'min(920px, 94vw)', height: 'min(82vh, 900px)', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 12px 40px rgba(0,0,0,.25)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <b style={{ fontSize: 14 }}>{title} <span style={{ color: 'var(--muted)', fontWeight: 400 }}>· {run.format.toUpperCase()} · {run.row_count ?? '—'} rows</span></b>
          <div style={{ display: 'flex', gap: 8 }}>
            {url && run.artifact_path && (
              <button className="btn" style={{ fontSize: 12 }} onClick={() => saveUrl(url, artifactFilename(run.artifact_path!))}>Download</button>
            )}
            <button className="btn ghost" style={{ fontSize: 12 }} onClick={onClose}>Close</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0, border: '1px solid var(--line)', borderRadius: 10, overflow: 'hidden', background: 'var(--surface)' }}>
          {err && <div style={{ padding: 20, color: 'var(--red)', fontSize: 13 }}>{err}</div>}
          {!err && !url && <div style={{ padding: 20, color: 'var(--muted)', fontSize: 13 }}>Loading…</div>}
          {url && canInline && <iframe title="Report preview" src={url} style={{ width: '100%', height: '100%', border: 0 }} />}
          {url && !canInline && (
            <div style={{ padding: 24, fontSize: 13, color: 'var(--muted)' }}>
              XLSX has no in-browser preview — use <b>Download</b> to open it in Excel.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--muted)', margin: '0 0 8px' }}>{title}</div>
      {children}
    </div>
  )
}
const Empty = ({ children }: { children: ReactNode }) => <div style={{ color: 'var(--muted)', fontSize: 13 }}>{children}</div>

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,22,28,.4)', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true"
        style={{ background: 'var(--card, #fff)', borderRadius: 14, padding: 20, width: 'min(440px, 92vw)', boxShadow: '0 12px 40px rgba(0,0,0,.2)' }}>
        {children}
      </div>
    </div>
  )
}

function ScheduleDialog({ formats, onClose, onCreate }: {
  formats: Format[]; onClose: () => void; onCreate: (cadence: string, tz: string, fmt: Format) => Promise<void>
}) {
  const [preset, setPreset] = useState<Preset>('weekly')
  const [time, setTime] = useState('08:00')
  const [weekday, setWeekday] = useState(1)
  const [dom, setDom] = useState(1)
  const [tz, setTz] = useState('Asia/Riyadh')
  const [format, setFormat] = useState<Format>(formats[0] ?? 'pdf')
  const [busy, setBusy] = useState(false)
  const cadence = cadenceToCron({ preset, time, weekday, dom })

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>Schedule this report</h3>
      <Field label="Frequency">
        <select value={preset} onChange={(e) => setPreset(e.target.value as Preset)} style={inp}>
          <option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option>
        </select>
      </Field>
      {preset === 'weekly' && (
        <Field label="Day of week">
          <select value={weekday} onChange={(e) => setWeekday(+e.target.value)} style={inp}>
            {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
          </select>
        </Field>
      )}
      {preset === 'monthly' && (
        <Field label="Day of month"><input type="number" min={1} max={28} value={dom} onChange={(e) => setDom(+e.target.value)} style={inp} /></Field>
      )}
      <Field label="Time"><input type="time" value={time} onChange={(e) => setTime(e.target.value)} style={inp} /></Field>
      <Field label="Timezone"><input value={tz} onChange={(e) => setTz(e.target.value)} style={inp} /></Field>
      <Field label="Format">
        <select value={format} onChange={(e) => setFormat(e.target.value as Format)} style={inp}>
          {formats.map((f) => <option key={f} value={f}>{f.toUpperCase()}</option>)}
        </select>
      </Field>
      <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 14px' }}>{describeCadence(cadence)} ({tz})</div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={busy} onClick={async () => { setBusy(true); try { await onCreate(cadence, tz, format) } finally { setBusy(false) } }}>
          {busy ? 'Saving…' : 'Create schedule'}
        </button>
      </div>
    </Overlay>
  )
}

interface Person { id: string; display_name: string; upn: string }

function EmailReportDialog({ run, onClose }: { run: ReportRun; onClose: () => void }) {
  const runId = run.id
  const [people, setPeople] = useState<Person[]>([])
  const [q, setQ] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [external, setExternal] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('profiles').select('id, display_name, upn').eq('is_active', true).order('display_name').limit(500)
      .then(({ data }) => setPeople((data ?? []) as Person[]))
    if (run.artifact_path && previewable(run.format)) {
      artifactSignedUrl(run.artifact_path).then(setPreviewUrl).catch(() => {})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = people.filter((p) => !q || (p.display_name + ' ' + p.upn).toLowerCase().includes(q.toLowerCase())).slice(0, 8)

  const send = async () => {
    setBusy(true); setResult(null)
    try {
      const ext = external.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
      const res = await emailReport(runId, { profile_ids: [...picked], external: ext })
      if (res.skipped) setResult(res.skipped)
      else {
        const refused = (res.refused ?? []).map((r) => `${r.address} (${r.reason})`).join('; ')
        setResult(`Sent to ${res.sent} recipient(s) as ${res.mode}.${refused ? ` Refused: ${refused}` : ''}`)
      }
    } catch (e) { setResult((e as Error).message) }
    finally { setBusy(false) }
  }

  return (
    <Overlay onClose={onClose}>
      <h3 style={{ marginTop: 0 }}>Email this report once</h3>
      {previewUrl && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>This is exactly what recipients receive ({run.format.toUpperCase()}):</div>
          <iframe title="Attachment preview" src={previewUrl}
            style={{ width: '100%', height: 200, border: '1px solid var(--line)', borderRadius: 8, background: 'var(--surface)' }} />
        </div>
      )}
      {!previewUrl && run.artifact_path && !previewable(run.format) && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
          Attachment: <span className="mono">{artifactFilename(run.artifact_path)}</span> ({run.row_count ?? '—'} rows — XLSX has no inline preview)
        </div>
      )}
      <Field label="Internal recipients">
        <input placeholder="Search people…" value={q} onChange={(e) => setQ(e.target.value)} style={inp} />
      </Field>
      <div style={{ maxHeight: 150, overflowY: 'auto', marginBottom: 10 }}>
        {filtered.map((p) => {
          const on = picked.has(p.id)
          return (
            <label key={p.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 2px', fontSize: 13, cursor: 'pointer' }}>
              <input type="checkbox" checked={on} onChange={() => setPicked((s) => { const n = new Set(s); on ? n.delete(p.id) : n.add(p.id); return n })} />
              <span>{p.display_name} <span style={{ color: 'var(--muted)' }}>· {p.upn}</span></span>
            </label>
          )
        })}
      </div>
      {picked.size > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{picked.size} selected</div>}
      <Field label="External addresses (allowlist + capability required)">
        <textarea value={external} onChange={(e) => setExternal(e.target.value)} placeholder="one per line or comma-separated" style={{ ...inp, minHeight: 54, resize: 'vertical' }} />
      </Field>
      {result && <div style={{ fontSize: 12, margin: '4px 0 10px', color: 'var(--ink)' }}>{result}</div>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn ghost" onClick={onClose}>Close</button>
        <button className="btn" disabled={busy || (picked.size === 0 && external.trim() === '')} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
      </div>
    </Overlay>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'block', marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 4 }}>{label}</div>
      {children}
    </label>
  )
}
const inp: CSSProperties = { width: '100%', padding: '8px 10px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 13, background: 'var(--card, #fff)', color: 'var(--ink)' }
