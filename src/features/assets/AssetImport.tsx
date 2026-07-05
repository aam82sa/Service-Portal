import { useRef, useState } from 'react'
import * as XLSX from 'xlsx'
import QRCode from 'qrcode'
import { supabase } from '../../lib/supabase'

export interface ImportRow {
  tag: string
  category: string
  model: string
  serial: string
  problem: string | null
}

interface ServerResult {
  row: number
  tag: string
  status: 'created' | 'duplicate' | 'error'
  message: string
}

const CATEGORIES = ['laptop', 'monitor', 'phone', 'printer', 'accessory']

const HEADER_ALIASES: Record<string, string> = {
  tag: 'tag', 'asset tag': 'tag', 'asset_tag': 'tag', 'asset': 'tag',
  category: 'category', type: 'category',
  model: 'model', 'device model': 'model',
  serial: 'serial', 'serial number': 'serial', 'serial_no': 'serial', sn: 'serial',
}

export function downloadTemplate() {
  const csv = 'tag,category,model,serial\nABC-LT-0100,laptop,Dell Latitude 7440,DL7440-0001\nABC-MN-0100,monitor,Dell U2723QE,U27-0001\n'
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = 'asset-import-template.csv'
  a.click()
  URL.revokeObjectURL(a.href)
}

export async function printLabels(items: { tag: string; model: string | null; serial: string | null }[]) {
  const labels = await Promise.all(
    items.map(async (a) => {
      const qr = await QRCode.toDataURL(a.tag, { width: 180, margin: 1 })
      return `<div class="label">
        <img src="${qr}" alt="${a.tag}" />
        <div class="tag">${a.tag}</div>
        <div class="meta">${a.model ?? ''}</div>
        <div class="meta">${a.serial ?? ''}</div>
      </div>`
    })
  )
  const w = window.open('', '_blank', 'width=460,height=640')
  if (!w) return
  w.document.write(`<!doctype html><html><head><title>Asset labels</title><style>
    body { font-family: 'JetBrains Mono', monospace; margin: 8mm; display: flex; flex-wrap: wrap; gap: 4mm; }
    .label { width: 40mm; border: 0.3mm dashed #999; padding: 2mm; text-align: center;
             page-break-inside: avoid; }
    .label img { width: 26mm; height: 26mm; }
    .tag { font-size: 9pt; font-weight: 700; }
    .meta { font-size: 6.5pt; color: #444; overflow: hidden; white-space: nowrap; }
    @media print { .label { border-color: transparent; } }
  </style></head><body>${labels.join('')}</body></html>`)
  w.document.close()
  w.focus()
  setTimeout(() => w.print(), 300)
}

export function ImportPanel({
  existing,
  onDone,
}: {
  existing: { tag: string; serial: string | null }[]
  onDone: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ImportRow[] | null>(null)
  const [fileName, setFileName] = useState('')
  const [results, setResults] = useState<ServerResult[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const parse = async (file: File) => {
    setError(null)
    setResults(null)
    try {
      const wb = XLSX.read(await file.arrayBuffer())
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      if (raw.length === 0) return setError('The file has no data rows.')

      const mapped: ImportRow[] = raw.map((r) => {
        const out: Record<string, string> = { tag: '', category: '', model: '', serial: '' }
        for (const [k, v] of Object.entries(r)) {
          const norm = HEADER_ALIASES[k.toString().trim().toLowerCase()]
          if (norm) out[norm] = String(v).trim()
        }
        return { ...out, problem: null } as ImportRow
      })

      const seenTags = new Set<string>()
      const seenSerials = new Set<string>()
      const sysTags = new Set(existing.map((a) => a.tag.toUpperCase()))
      const sysSerials = new Set(existing.filter((a) => a.serial).map((a) => a.serial!.toUpperCase()))
      for (const m of mapped) {
        const tag = m.tag.toUpperCase()
        const serial = m.serial.toUpperCase()
        if (!tag) m.problem = 'missing tag'
        else if (!CATEGORIES.includes(m.category.toLowerCase())) m.problem = `unknown category "${m.category}"`
        else if (sysTags.has(tag)) m.problem = 'duplicate: tag already in system'
        else if (seenTags.has(tag)) m.problem = 'duplicate tag within file'
        else if (serial && sysSerials.has(serial)) m.problem = 'duplicate: serial already in system'
        else if (serial && seenSerials.has(serial)) m.problem = 'duplicate serial within file'
        if (!m.problem) {
          seenTags.add(tag)
          if (serial) seenSerials.add(serial)
        }
      }
      setFileName(file.name)
      setRows(mapped)
    } catch {
      setError('Could not read the file — use .xlsx, .xls or .csv with columns tag, category, model, serial.')
    }
  }

  const runImport = async () => {
    if (!rows) return
    setBusy(true)
    setError(null)
    const valid = rows.filter((r) => !r.problem)
    const { data, error: e } = await supabase.rpc('import_assets', {
      p_rows: valid.map((r) => ({ tag: r.tag, category: r.category.toLowerCase(), model: r.model, serial: r.serial })),
    })
    setBusy(false)
    if (e) return setError(e.message)
    setResults(data as ServerResult[])
    setRows(null)
    onDone()
  }

  const validCount = rows?.filter((r) => !r.problem).length ?? 0

  return (
    <>
      <input
        ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) parse(f); e.target.value = '' }}
      />
      <button className="btn" onClick={() => fileRef.current?.click()}>Import Excel/CSV</button>

      {rows && (
        <div className="card" style={{ marginTop: 12, width: '100%' }}>
          <div className="row" style={{ background: 'var(--surface)' }}>
            <span style={{ fontSize: 12.5, fontWeight: 500, flex: 1 }}>
              {fileName} — {rows.length} rows · {validCount} ready · {rows.length - validCount} with problems
            </span>
            <button className="btn primary" onClick={runImport} disabled={busy || validCount === 0}>
              {busy ? 'Importing…' : `Import ${validCount} valid rows`}
            </button>
            <button className="btn" onClick={() => setRows(null)}>Cancel</button>
          </div>
          {rows.map((r, i) => (
            <div className="row" key={i} style={{ opacity: r.problem ? 0.85 : 1 }}>
              <span className="mono" style={{ fontSize: 11, width: 110 }}>{r.tag || '—'}</span>
              <span className="chip" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{r.category || '?'}</span>
              <span style={{ fontSize: 12, flex: 1 }}>{r.model}</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted)' }}>{r.serial}</span>
              {r.problem ? (
                <span className="chip" style={{ background: 'var(--red-soft)', color: 'var(--red)' }}>{r.problem}</span>
              ) : (
                <span className="chip" style={{ background: 'var(--green-soft)', color: 'var(--green)' }}>ready</span>
              )}
            </div>
          ))}
        </div>
      )}

      {results && (
        <div className="card" style={{ marginTop: 12, width: '100%' }}>
          <div className="row" style={{ background: 'var(--surface)', fontSize: 12.5, fontWeight: 500 }}>
            Import finished: {results.filter((r) => r.status === 'created').length} created ·{' '}
            {results.filter((r) => r.status !== 'created').length} rejected by the database
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setResults(null)}>Dismiss</button>
          </div>
          {results.filter((r) => r.status !== 'created').map((r) => (
            <div className="row" key={r.row}>
              <span className="mono" style={{ fontSize: 11, width: 110 }}>{r.tag}</span>
              <span className="chip" style={{ background: 'var(--amber-soft)', color: 'var(--amber)' }}>{r.status}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.message}</span>
            </div>
          ))}
        </div>
      )}
      {error && <p className="error-note">{error}</p>}
    </>
  )
}
