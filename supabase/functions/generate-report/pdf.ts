/**
 * PDF rendering for reports. The high-fidelity path is a dedicated headless-
 * Chrome worker (Branch 3) that generates a print-quality document from the
 * same components Insights uses; generate-report calls it over HTTP with a
 * shared secret. Until that worker is hosted, `renderReportPdf` falls back to a
 * programmatic pdf-lib table so the module works everywhere.
 *
 * The fallback uses Helvetica (WinAnsi), which cannot render Arabic — cells are
 * reduced to printable ASCII so it never throws; the worker handles full script.
 */

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

import type { Bar, ColSpec, Kpi } from './presentation.ts'

export interface PdfInput {
  title: string
  subtitle?: string
  columns: ColSpec[] | string[]
  rows: Record<string, unknown>[]
  runBy?: string
  rowCountTotal?: number
  kpis?: Kpi[]
  bars?: Bar[]
  totalsRow?: Record<string, unknown>
  containsPersonalData?: boolean
}

/** column keys/labels regardless of whether specs or plain strings came in */
const colKey = (c: ColSpec | string) => (typeof c === 'string' ? c : c.key)
const colLabel = (c: ColSpec | string) => (typeof c === 'string' ? c : c.label)

/** Keep only WinAnsi-safe printable ASCII; everything else becomes '?'. */
function asciiSafe(s: string): string {
  let out = ''
  for (const ch of s) {
    const c = ch.charCodeAt(0)
    out += c >= 0x20 && c <= 0x7e ? ch : c === 0x09 || c === 0x0a ? ' ' : '?'
  }
  return out
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'object' ? JSON.stringify(v) : String(v)
}

/** Programmatic tabular PDF — the fallback when no rendering worker is set. */
export async function fallbackPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  const pageW = 842, pageH = 595            // A4 landscape, points
  const margin = 36
  const rowH = 16, size = 8
  const cols = input.columns.length > 0 ? input.columns.map(colKey) : ['(no columns)']
  const labels = input.columns.length > 0 ? input.columns.map(colLabel) : ['(no columns)']
  const colW = (pageW - margin * 2) / cols.length

  let page = doc.addPage([pageW, pageH])
  let y = pageH - margin

  const draw = (s: string, x: number, yy: number, f = font, sz = size) =>
    page.drawText(asciiSafe(s).slice(0, 64), { x, y: yy, size: sz, font: f, color: rgb(0.1, 0.1, 0.12) })

  draw(input.title, margin, y, bold, 14); y -= 20
  if (input.subtitle) { draw(input.subtitle, margin, y, font, 9); y -= 16 }
  y -= 4

  const header = () => {
    labels.forEach((c, i) => draw(c, margin + i * colW, y, bold, size))
    y -= rowH
  }
  header()

  for (const r of input.rows) {
    if (y < margin + rowH) { page = doc.addPage([pageW, pageH]); y = pageH - margin; header() }
    cols.forEach((c, i) => draw(cellText(r[c]), margin + i * colW, y, font, size))
    y -= rowH
  }
  return await doc.save()
}

/**
 * Render a report to PDF: prefer the rendering worker (Branch 3) when
 * REPORT_PDF_WORKER_URL + REPORT_PDF_WORKER_SECRET are configured, otherwise
 * use the pdf-lib fallback. A worker error or non-2xx also falls back, so a
 * worker outage degrades gracefully rather than failing the run.
 */
export async function renderReportPdf(
  env: (k: string) => string | undefined,
  input: PdfInput,
): Promise<Uint8Array> {
  const url = env('REPORT_PDF_WORKER_URL')
  const secret = env('REPORT_PDF_WORKER_SECRET')
  if (url && secret) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-worker-secret': secret },
        body: JSON.stringify(input),
      })
      if (res.ok) return new Uint8Array(await res.arrayBuffer())
    } catch {
      // fall through to the programmatic fallback
    }
  }
  return fallbackPdf(input)
}
