/**
 * Shared report dialogs — Schedule + Email-once. Extracted from Reports.tsx
 * so the analytics dashboard's action bar (Zone 1) can reuse them without a
 * Reports ↔ AnalyticsDashboard import cycle.
 */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { supabase } from '../../lib/supabase'
import { artifactSignedUrl, emailReport, type Format, type ReportRun } from './api'
import { artifactFilename, previewable } from './artifact'
import { cadenceToCron, describeCadence, WEEKDAYS, type Preset } from './cron'

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

export function ScheduleDialog({ formats, onClose, onCreate }: {
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

export function EmailReportDialog({ run, onClose }: { run: ReportRun; onClose: () => void }) {
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
