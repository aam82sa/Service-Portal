/**
 * PDF rendering for reports. The high-fidelity path is a dedicated headless-
 * Chrome worker (Branch 3) that renders the full Services Hub template with
 * proper fonts and Arabic support; generate-report calls it over HTTP with a
 * shared secret. Until that worker is hosted, `renderReportPdf` falls back to
 * this programmatic pdf-lib renderer, which draws the SAME design language
 * (reporttemplatesspec.md tokens: accent header, KPI band, chart bars, chips,
 * department rails, zebra rows, totals, per-page footers) so fallback PDFs
 * look designed too.
 *
 * Fallback limits vs the worker: Latin text stays Helvetica/Courier (no
 * Space Grotesk / Inter / JetBrains Mono). Arabic renders CORRECTLY through
 * the committed Noto Sans Arabic fonts (@pdf-lib/fontkit shapes the joining
 * forms and returns Arabic runs in visual order; artext.ts handles the bidi
 * run ordering for mixed lines) — non-Latin no longer degrades to '?'.
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage, type RGB } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

import { hasArabic, visualRuns } from './artext.ts'
import type { Bar, ColSpec, Kpi, Tone } from './presentation.ts'

const readFont = (rel: string): Uint8Array =>
  new Uint8Array(readFileSync(fileURLToPath(new URL(rel, import.meta.url))))

export interface PdfSection {
  title: string
  kind: 'kpi' | 'bar' | 'table'
  columns: string[]
  rows: Record<string, unknown>[]
}

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
  /** dashboard document mode: render titled sections instead of the single table */
  sections?: PdfSection[]
}

// ---- Services Hub tokens (as pdf-lib colors) ----
const hex = (h: string): RGB => rgb(parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255)
const C = {
  ink: hex('#10192E'), muted: hex('#5b606b'), faint: hex('#9aa0ab'),
  surface: hex('#F4F5F8'), line: hex('#DDE0E8'), rowLine: hex('#EEF0F4'), zebra: hex('#FAFBFC'),
  accent: hex('#D97757'), green: hex('#2E9E6B'), amber: hex('#DE9B2D'), red: hex('#D64545'),
  white: rgb(1, 1, 1),
}
const TONE: Record<Tone, RGB> = { green: C.green, amber: C.amber, red: C.red, ink: C.ink, faint: C.faint }
const DEPT: Record<string, RGB> = {
  IT: hex('#3E6DD8'), ADMIN: hex('#8A5FC9'), LOG: hex('#2E9E6B'), PROC: hex('#DE9B2D'),
}
/** blend a color toward white — the 10% chip tints */
const tint = (c: RGB, a: number): RGB => rgb(c.red * a + (1 - a), c.green * a + (1 - a), c.blue * a + (1 - a))

const colKey = (c: ColSpec | string) => (typeof c === 'string' ? c : c.key)
const spec = (c: ColSpec | string): ColSpec => (typeof c === 'string' ? { key: c, label: c } : c)

/** Keep only WinAnsi-safe printable ASCII plus a few safe punctuation marks. */
function asciiSafe(s: string): string {
  let out = ''
  for (const ch of s) {
    if ('—–·’‘“”'.includes(ch)) { out += ch; continue } // WinAnsi-safe punctuation
    const c = ch.charCodeAt(0)
    out += c >= 0x20 && c <= 0x7e ? ch : c === 0x09 || c === 0x0a ? ' ' : '?'
  }
  return out
}

const nfmt = (n: number) => n.toLocaleString('en-US')

function cellText(c: ColSpec, v: unknown): { text: string; faint: boolean } {
  if (v === null || v === undefined || v === '') return { text: '—', faint: true }
  switch (c.format) {
    case 'number': {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isNaN(n) ? { text: '—', faint: true } : { text: nfmt(n), faint: false }
    }
    case 'sar': {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isNaN(n) ? { text: '—', faint: true } : { text: `${nfmt(n)} SAR`, faint: false }
    }
    case 'date': case 'datetime': {
      const d = new Date(String(v))
      if (Number.isNaN(d.getTime())) return { text: asciiSafe(String(v)), faint: false }
      const base = d.toISOString().slice(0, 10)
      return { text: c.format === 'datetime' ? `${base} ${d.toISOString().slice(11, 16)}` : base, faint: false }
    }
    default:
      if (typeof v === 'boolean') return { text: v ? 'Yes' : 'No', faint: false }
      if (typeof v === 'object') return { text: asciiSafe(JSON.stringify(v)), faint: false }
      return { text: asciiSafe(String(v)), faint: false }
  }
}

function chipFor(c: ColSpec, v: unknown): { text: string; color: RGB } | null | undefined {
  if (c.chip === 'priority') {
    const p = String(v ?? '').toUpperCase()
    if (!p) return null
    return { text: p, color: p === 'P1' ? C.red : p === 'P2' ? C.amber : p === 'P3' ? C.muted : C.faint }
  }
  if (c.chip === 'boolean') {
    if (v === null || v === undefined || v === '') return null
    const truthy = v === true || v === 'true' || v === 1
    if (c.key === 'breached') return truthy ? { text: 'Breached', color: C.red } : null
    return truthy ? { text: 'Yes', color: C.green } : { text: 'No', color: C.red }
  }
  if (c.chip === 'status') {
    const raw = String(v ?? '')
    if (!raw) return null
    const k = raw.toLowerCase().replace(/[\s-]/g, '_')
    const color = ['in_use', 'assigned', 'on_track', 'active'].includes(k) ? C.green
      : ['repair', 'in_repair', 'at_risk'].includes(k) ? C.amber
      : k === 'delayed' ? C.red
      : ['in_stock', 'retired', 'closed'].includes(k) ? C.faint : C.muted
    return { text: asciiSafe(raw.replace(/_/g, ' ')), color }
  }
  return undefined // not a chip column
}

/** Designed tabular PDF — the fallback when no rendering worker is set. */
export async function fallbackPdf(input: PdfInput): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const mono = await doc.embedFont(StandardFonts.Courier)
  const monoB = await doc.embedFont(StandardFonts.CourierBold)
  // Arabic: one upfront scan decides whether to embed the committed Noto
  // Sans Arabic pair — Latin-only reports carry no extra font payload, and
  // `subset: true` keeps the artifact small when they are embedded
  const inputStrings = [
    input.title, input.subtitle ?? '', input.runBy ?? '',
    ...(input.kpis ?? []).flatMap((k) => [k.value, k.label]),
    ...(input.bars ?? []).map((b) => b.label),
    ...input.columns.map((c) => spec(c).label),
    ...input.rows.flatMap((r) => Object.values(r).map((v) => String(v ?? ''))),
    ...Object.values(input.totalsRow ?? {}).map((v) => String(v ?? '')),
    ...(input.sections ?? []).flatMap((sec) => [
      sec.title, ...sec.columns, ...sec.rows.flatMap((r) => Object.values(r).map((v) => String(v ?? ''))),
    ]),
  ]
  const needsArabic = inputStrings.some(hasArabic)
  const ar = needsArabic
    ? {
        regular: await doc.embedFont(readFont('./fonts/NotoSansArabic-Regular.ttf'), { subset: true }),
        bold: await doc.embedFont(readFont('./fonts/NotoSansArabic-Bold.ttf'), { subset: true }),
      }
    : null

  const pageW = 842, pageH = 595, margin = 40
  const baseCols = (input.columns.length ? input.columns : ['(no columns)']).map(spec)
  const baseColW = (pageW - margin * 2) / baseCols.length
  const rowH = 16
  interface TableCtx { cols: ColSpec[]; colW: number }
  const baseCtx: TableCtx = { cols: baseCols, colW: baseColW }

  let page: PDFPage = doc.addPage([pageW, pageH])
  let y = pageH - margin

  const text = (s: string, x: number, yy: number, o: { font?: PDFFont; size?: number; color?: RGB; right?: number } = {}) => {
    const font = o.font ?? helv, size = o.size ?? 8

    if (ar && hasArabic(s)) {
      // mixed/RTL line: draw the visual-order runs sequentially — Arabic runs
      // with Noto (fontkit shapes + orders the glyphs), the rest as before.
      // The bold/monoB Latin styles map to the Arabic bold face.
      const arFont = font === bold || font === monoB ? ar.bold : ar.regular
      const runs = visualRuns(s).map((r) => ({
        ...r,
        font: r.arabic ? arFont : font,
        drawn: r.arabic ? r.text : asciiSafe(r.text),
      }))
      const total = runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.drawn, size), 0)
      let cx = o.right !== undefined ? o.right - total : x
      for (const r of runs) {
        page.drawText(r.drawn, { x: cx, y: yy, size, font: r.font, color: o.color ?? C.ink })
        cx += r.font.widthOfTextAtSize(r.drawn, size)
      }
      return
    }

    const t = asciiSafe(s)
    const x2 = o.right !== undefined ? o.right - font.widthOfTextAtSize(t, size) : x
    page.drawText(t, { x: x2, y: yy, size, font, color: o.color ?? C.ink })
  }
  const rect = (x: number, yy: number, w: number, h: number, color: RGB) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color })

  // ---- header (first page only) ----
  text(input.title.slice(0, 64), margin, y - 14, { font: bold, size: 20 })
  text('ABC CORP · SERVICES HUB', 0, y - 8, { font: bold, size: 9, color: C.accent, right: pageW - margin })
  const meta = `Generated ${new Date().toISOString().replace('T', ' ').slice(0, 16)} (Asia/Riyadh)${input.runBy ? ` · Run by ${input.runBy}` : ''} · ${nfmt(input.rowCountTotal ?? input.rows.length)} rows`
  text(meta, 0, y - 20, { size: 8, color: C.faint, right: pageW - margin })
  y -= 26
  if (input.subtitle) { text(input.subtitle.slice(0, 140), margin, y - 6, { size: 8.5, color: C.muted }); y -= 12 }
  rect(margin, y - 4, pageW - margin * 2, 2, C.accent)
  y -= 16

  // ---- personal-data banner ----
  if (input.containsPersonalData) {
    rect(margin, y - 20, pageW - margin * 2, 22, tint(C.red, 0.08))
    rect(margin + 6, y - 15, monoB.widthOfTextAtSize('PERSONAL DATA', 7.5) + 8, 12, C.red)
    text('PERSONAL DATA', margin + 10, y - 12, { font: monoB, size: 7.5, color: C.white })
    text('Restricted to department heads and HR. Handle per the data-protection policy. Do not forward.',
      margin + monoB.widthOfTextAtSize('PERSONAL DATA', 7.5) + 22, y - 12, { size: 8, color: C.ink })
    y -= 30
  }

  /** start a new page when fewer than `need` points remain */
  const ensure = (need: number) => {
    if (y < margin + need) { page = doc.addPage([pageW, pageH]); y = pageH - margin }
  }

  const drawKpiBand = (kpis: Kpi[]) => {
    let x = margin
    for (const k of kpis) {
      const color = TONE[k.tone ?? 'ink']
      text(k.value, x, y - 16, { font: bold, size: 18, color })
      text(k.label.toUpperCase(), x, y - 26, { size: 6.5, color: C.faint })
      x += Math.max(bold.widthOfTextAtSize(asciiSafe(k.value), 18), helv.widthOfTextAtSize(asciiSafe(k.label.toUpperCase()), 6.5)) + 30
    }
    rect(margin, y - 32, pageW - margin * 2, 0.7, C.rowLine)
    y -= 42
  }

  const drawBarsBlock = (bars: Bar[]) => {
    const max = Math.max(1, ...bars.map((b) => b.value))
    const labelW = 90, valueW = 50
    const trackW = pageW - margin * 2 - labelW - valueW - 16
    for (const b of bars) {
      text(b.label.slice(0, 18), margin, y - 8, { size: 8, color: C.muted })
      rect(margin + labelW, y - 10, trackW, 10, C.surface)
      rect(margin + labelW, y - 10, Math.max(2, (b.value / max) * trackW), 10, hex(b.color.startsWith('#') ? b.color : '#5b606b'))
      text(nfmt(b.value), 0, y - 8, { font: mono, size: 8, right: pageW - margin })
      y -= 15
    }
    y -= 8
  }

  // ---- KPI band ----
  if (input.kpis?.length) drawKpiBand(input.kpis)

  // ---- chart bars ----
  if (input.bars?.length) drawBarsBlock(input.bars)

  // ---- table (parametrized so dashboard sections can each draw their own) ----
  const drawHeadRow = (ctx: TableCtx = baseCtx) => {
    const { cols, colW } = ctx
    rect(margin, y - rowH + 3, pageW - margin * 2, rowH, C.surface)
    cols.forEach((c, i) => {
      const label = c.label.toUpperCase().slice(0, 26)
      const numeric = c.align === 'right' || c.format === 'number' || c.format === 'sar'
      if (numeric) text(label, 0, y - 8, { font: bold, size: 6.8, color: hex('#3a3d45'), right: margin + (i + 1) * colW - 6 })
      else text(label, margin + i * colW + 6, y - 8, { font: bold, size: 6.8, color: hex('#3a3d45') })
    })
    page.drawLine({ start: { x: margin, y: y - rowH + 3 }, end: { x: pageW - margin, y: y - rowH + 3 }, thickness: 0.8, color: C.line })
    y -= rowH + 2
  }
  const drawDataRow = (r: Record<string, unknown>, opts: { zebra?: boolean; totals?: boolean } = {}, ctx: TableCtx = baseCtx) => {
    const { cols, colW } = ctx
    if (y < margin + rowH + 14) { page = doc.addPage([pageW, pageH]); y = pageH - margin; drawHeadRow(ctx) }
    if (opts.zebra && !opts.totals) rect(margin, y - rowH + 4, pageW - margin * 2, rowH - 1, C.zebra)
    if (opts.totals) page.drawLine({ start: { x: margin, y: y + 3 }, end: { x: pageW - margin, y: y + 3 }, thickness: 0.8, color: C.line })
    cols.forEach((c, i) => {
      const x0 = margin + i * colW
      if (opts.totals && r[c.key] === undefined) return
      const chip = chipFor(c, r[c.key])
      if (chip === null) { text('—', x0 + 6, y - 7, { size: 8, color: C.faint }); return }
      if (chip) {
        const w = monoB.widthOfTextAtSize(chip.text, 7) + 8
        rect(x0 + 5, y - 10, Math.min(w, colW - 10), 11, tint(chip.color, 0.1))
        text(chip.text.slice(0, 20), x0 + 9, y - 7, { font: monoB, size: 7, color: chip.color })
        return
      }
      if (c.deptRail) rect(x0 + 1, y - 10, 2.5, 12, DEPT[String(r[c.key] ?? '').toUpperCase()] ?? C.muted)
      const { text: t, faint } = cellText(c, r[c.key])
      const tone = c.toneKey ? (r[c.toneKey] as Tone | undefined) : undefined
      const numeric = c.align === 'right' || c.format === 'number' || c.format === 'sar'
      const useMono = ['number', 'sar', 'date', 'datetime', 'id'].includes(c.format ?? '')
      const font = opts.totals || tone ? (useMono ? monoB : bold) : useMono ? mono : helv
      const color = tone ? TONE[tone] : faint ? C.faint : C.ink
      if (numeric) text(t.slice(0, 28), 0, y - 7, { font, size: 8, color, right: margin + (i + 1) * colW - 6 })
      else text(t.slice(0, Math.floor(colW / 4)), x0 + (c.deptRail ? 7 : 6), y - 7, { font, size: 8, color })
    })
    if (!opts.totals) page.drawLine({ start: { x: margin, y: y - rowH + 4 }, end: { x: pageW - margin, y: y - rowH + 4 }, thickness: 0.5, color: C.rowLine })
    y -= rowH
  }

  if (input.sections?.length) {
    // ---- dashboard document mode: KPI band, then titled per-widget blocks ----
    const SECTION_COLORS = ['#3E6DD8', '#2E9E6B', '#DE9B2D', '#D64545', '#8A5FC9', '#5b606b']
    const fmtVal = (v: unknown) => {
      const n = typeof v === 'number' ? v : Number(v)
      return Number.isFinite(n) ? nfmt(Math.round(n * 100) / 100) : String(v ?? '—')
    }
    const kpiSecs = input.sections.filter((sec) => sec.kind === 'kpi')
    if (kpiSecs.length) {
      ensure(60)
      drawKpiBand(kpiSecs.map((sec) => ({
        value: fmtVal(sec.rows[0]?.['value'] ?? sec.rows.length),
        label: sec.title,
      })))
    }
    const heading = (t: string) => {
      ensure(70)
      text(t.slice(0, 80).toUpperCase(), margin, y - 10, { font: bold, size: 8.5, color: C.muted })
      rect(margin, y - 14, pageW - margin * 2, 0.7, C.rowLine)
      y -= 22
    }
    for (const sec of input.sections) {
      if (sec.kind === 'kpi') continue
      if (sec.kind === 'bar') {
        const groupKey = sec.columns[0]
        const bars: Bar[] = sec.rows.slice(0, 8).map((r, i) => ({
          label: String(r[groupKey] ?? '—'),
          value: Number(r['value']) || 0,
          color: SECTION_COLORS[i % SECTION_COLORS.length],
        }))
        ensure(70 + bars.length * 15)
        heading(sec.title)
        if (bars.length) drawBarsBlock(bars)
        else { text('No data.', margin, y - 8, { size: 8, color: C.faint }); y -= 18 }
        continue
      }
      // table section: plain columns, capped so the document stays a document
      const CAP = 40
      const sCols = sec.columns.map((k) => ({ key: k, label: k }) as ColSpec)
      const ctx: TableCtx = { cols: sCols, colW: (pageW - margin * 2) / Math.max(1, sCols.length) }
      heading(sec.title)
      drawHeadRow(ctx)
      if (sec.rows.length === 0) { text('No data.', margin + 6, y - 8, { size: 8, color: C.faint }); y -= rowH }
      sec.rows.slice(0, CAP).forEach((r, i) => drawDataRow(r, { zebra: i % 2 === 1 }, ctx))
      if (sec.rows.length > CAP) {
        text(`Showing the first ${CAP} of ${nfmt(sec.rows.length)} rows — export XLSX for the full set.`,
          margin, y - 9, { size: 7.5, color: C.faint })
        y -= 16
      }
      y -= 6
    }
  } else {
    drawHeadRow()
    if (input.rows.length === 0) {
      text('No data for this report.', pageW / 2 - 50, y - 10, { size: 9, color: C.faint })
      y -= rowH
    }
    input.rows.forEach((r, i) => drawDataRow(r, { zebra: i % 2 === 1 }))
    if (input.totalsRow) drawDataRow(input.totalsRow, { totals: true })
  }

  // ---- per-page footer (drawn last so Page N of M is known) ----
  const pages = doc.getPages()
  pages.forEach((p, i) => {
    page = p
    const conf = input.containsPersonalData
      ? 'RESTRICTED — Personal data. Access limited to dept heads & HR. Redistribution prohibited.'
      : 'Confidential — generated under the requesting owner’s data access.'
    text(conf, margin, 22, { size: 7, color: input.containsPersonalData ? C.red : C.faint, font: input.containsPersonalData ? bold : helv })
    text(`Page ${i + 1} of ${pages.length}`, 0, 22, { font: mono, size: 7, color: C.faint, right: pageW - margin })
  })

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
