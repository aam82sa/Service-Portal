/**
 * Report HTML template for the high-fidelity PDF worker — Services Hub design
 * language (reporttemplatesspec.md, cards 1a–1h). Pure and side-effect free so
 * it is unit-tested without a browser: given the report's columns + rows it
 * returns a self-contained, print-ready HTML document that headless Chrome
 * turns into a PDF.
 *
 * Optional inputs (kpis, bars, ColumnSpec chips/rails/formats, totalsRow,
 * containsPersonalData) light up the richer anatomy; a plain columns+rows call
 * still renders a valid basic report. Every data value passes escapeHtml — the
 * rows are the requesting owner's real data and must never inject markup.
 */

export type Tone = 'green' | 'amber' | 'red' | 'ink' | 'faint'

export interface ColumnSpec {
  key: string
  label: string
  align?: 'left' | 'right'
  format?: 'text' | 'number' | 'sar' | 'date' | 'datetime' | 'id'
  chip?: 'priority' | 'boolean' | 'status'
  deptRail?: boolean
  /** per-row tone override (e.g. age thresholds, SLA margin sign) */
  tone?: (row: Record<string, unknown>) => Tone | undefined
  /** serializable alternative to `tone` for HTTP payloads: a row key holding a
   *  Tone precomputed by the caller (generate-report), e.g. '_tone_age_days' */
  toneKey?: string
}

export interface ReportHtmlInput {
  title: string
  subtitle?: string // params line: period, filters, sort, timezone
  columns: ColumnSpec[] | string[]
  rows: Record<string, unknown>[]
  generatedAt?: string
  runBy?: string
  rowCountTotal?: number
  direction?: 'ltr' | 'rtl'
  kpis?: { value: string; label: string; tone?: Tone }[]
  bars?: { label: string; value: number; color: string }[]
  containsPersonalData?: boolean
  totalsRow?: Record<string, unknown>
}

// ---- Services Hub tokens ----
export const TOKENS = {
  ink: '#10192E', muted: '#5b606b', faint: '#9aa0ab',
  surface: '#F4F5F8', line: '#DDE0E8', rowLine: '#EEF0F4', zebra: '#FAFBFC',
  accent: '#D97757', green: '#2E9E6B', amber: '#DE9B2D', red: '#D64545',
} as const

/** Department rail colors; unknown departments fall back to muted. */
export const DEPT_COLOR: Record<string, string> = {
  IT: '#3E6DD8', ADMIN: '#8A5FC9', LOG: '#2E9E6B', LOGISTICS: '#2E9E6B',
  PROC: '#DE9B2D', // not in the token sheet — amber keeps it distinct
}

const TONE_COLOR: Record<Tone, string> = {
  green: TOKENS.green, amber: TOKENS.amber, red: TOKENS.red,
  ink: TOKENS.ink, faint: TOKENS.faint,
}

export function escapeHtml(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

const EMDASH = `<span class="faint">—</span>`

const nf = new Intl.NumberFormat('en-US')

function fmtNumber(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v)
  if (v === null || v === undefined || v === '' || Number.isNaN(n)) return EMDASH
  return escapeHtml(nf.format(n))
}

function fmtDate(v: unknown, withTime: boolean): string {
  if (v === null || v === undefined || v === '') return EMDASH
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return escapeHtml(v)
  const date = d.toISOString().slice(0, 10)
  return escapeHtml(withTime ? `${date} ${d.toISOString().slice(11, 16)}` : date)
}

function tint(hex: string, alphaPct: number): string {
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alphaPct / 100})`
}

function chipHtml(text: string, fg: string, bgAlpha = 10): string {
  return `<span class="chip" style="color:${fg};background:${tint(fg, bgAlpha)}">${escapeHtml(text)}</span>`
}

function priorityChip(v: unknown): string {
  const p = String(v ?? '').toUpperCase()
  const fg = p === 'P1' ? TOKENS.red : p === 'P2' ? TOKENS.amber : p === 'P3' ? TOKENS.muted : TOKENS.faint
  if (!p) return EMDASH
  return chipHtml(p, fg, p === 'P4' ? 12 : 10)
}

function booleanChip(key: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return EMDASH
  const truthy = v === true || v === 'true' || v === 1
  if (key === 'breached') return truthy ? chipHtml('Breached', TOKENS.red) : EMDASH
  return truthy ? chipHtml('Yes', TOKENS.green) : chipHtml('No', TOKENS.red)
}

const STATUS_TONE: Record<string, string> = {
  in_use: TOKENS.green, assigned: TOKENS.green, on_track: TOKENS.green, active: TOKENS.green,
  repair: TOKENS.amber, in_repair: TOKENS.amber, at_risk: TOKENS.amber,
  delayed: TOKENS.red,
  in_stock: TOKENS.faint, retired: TOKENS.faint, closed: TOKENS.faint,
}

function statusChip(v: unknown): string {
  const raw = String(v ?? '')
  if (!raw) return EMDASH
  const fg = STATUS_TONE[raw.toLowerCase().replace(/[\s-]/g, '_')] ?? TOKENS.muted
  return chipHtml(raw.replace(/_/g, ' '), fg)
}

/** One data cell rendered per its ColumnSpec. */
export function cellHtml(spec: ColumnSpec, row: Record<string, unknown>): string {
  const v = row[spec.key]
  if (spec.chip === 'priority') return priorityChip(v)
  if (spec.chip === 'boolean') return booleanChip(spec.key, v)
  if (spec.chip === 'status') return statusChip(v)

  let body: string
  switch (spec.format) {
    case 'number': body = fmtNumber(v); break
    case 'sar': body = v === null || v === undefined || v === '' ? EMDASH : `${fmtNumber(v)} SAR`; break
    case 'date': body = fmtDate(v, false); break
    case 'datetime': body = fmtDate(v, true); break
    case 'id': body = v === null || v === undefined || v === '' ? EMDASH : `<span class="mono">${escapeHtml(v)}</span>`; break
    default:
      if (v === null || v === undefined || v === '') body = EMDASH
      else if (typeof v === 'boolean') body = v ? 'Yes' : 'No'
      else if (typeof v === 'object') body = escapeHtml(JSON.stringify(v))
      else body = escapeHtml(v)
  }
  const tone = spec.tone?.(row) ?? (spec.toneKey ? (row[spec.toneKey] as Tone | undefined) : undefined)
  if (tone) body = `<span style="color:${TONE_COLOR[tone]};font-weight:600">${body}</span>`
  return body
}

function normalizeColumns(columns: ColumnSpec[] | string[]): ColumnSpec[] {
  return columns.map((c) => (typeof c === 'string' ? { key: c, label: c } : c))
}

const isMono = (c: ColumnSpec) =>
  c.format === 'number' || c.format === 'sar' || c.format === 'date' || c.format === 'datetime' || c.format === 'id'

export function reportHtml(input: ReportHtmlInput): string {
  const dir = input.direction === 'rtl' ? 'rtl' : 'ltr'
  const align = dir === 'rtl' ? 'right' : 'left'
  const metaAlign = dir === 'rtl' ? 'left' : 'right'
  const cols = normalizeColumns(input.columns.length ? input.columns : ['(no columns)'])
  const generatedAt = (input.generatedAt ?? new Date().toISOString()).replace('T', ' ').slice(0, 16)
  const totalRows = input.rowCountTotal ?? input.rows.length

  const tdClass = (c: ColumnSpec) => {
    const cls: string[] = []
    if (c.align === 'right' || (c.align === undefined && (c.format === 'number' || c.format === 'sar'))) cls.push('num')
    if (isMono(c)) cls.push('mono-cell')
    return cls.length ? ` class="${cls.join(' ')}"` : ''
  }
  const railStyle = (c: ColumnSpec, row: Record<string, unknown>) => {
    if (!c.deptRail) return ''
    const dept = String(row[c.key] ?? '').toUpperCase()
    const color = DEPT_COLOR[dept] ?? TOKENS.muted
    return ` style="border-left:3px solid ${color};padding-left:6px"`
  }

  const head = cols.map((c) => `<th${c.align === 'right' || c.format === 'number' || c.format === 'sar' ? ' class="num"' : ''}>${escapeHtml(c.label)}</th>`).join('')
  const bodyRows = input.rows.length
    ? input.rows.map((r) => `<tr>${cols.map((c) => `<td${tdClass(c)}${railStyle(c, r)}>${cellHtml(c, r)}</td>`).join('')}</tr>`).join('')
    : `<tr><td class="empty" colspan="${cols.length}">No data for this report.</td></tr>`
  const totals = input.totalsRow
    ? `<tr class="totals">${cols.map((c) => `<td${tdClass(c)}>${input.totalsRow![c.key] === undefined ? '' : cellHtml(c, input.totalsRow!)}</td>`).join('')}</tr>`
    : ''

  const kpiBand = input.kpis?.length
    ? `<div class="kpis">${input.kpis.map((k) => `
        <div class="kpi"><div class="kpi-value" style="color:${TONE_COLOR[k.tone ?? 'ink']}">${escapeHtml(k.value)}</div>
        <div class="kpi-label">${escapeHtml(k.label)}</div></div>`).join('')}</div>`
    : ''

  const maxBar = Math.max(1, ...(input.bars ?? []).map((b) => b.value))
  const barBand = input.bars?.length
    ? `<div class="bars">${input.bars.map((b) => `
        <div class="bar-row"><div class="bar-label">${escapeHtml(b.label)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${Math.round((b.value / maxBar) * 100)}%;background:${escapeHtml(b.color)}"></div></div>
        <div class="bar-value mono">${fmtNumber(b.value)}</div></div>`).join('')}</div>`
    : ''

  const pdBanner = input.containsPersonalData
    ? `<div class="pd-banner"><span class="pd-badge">PERSONAL DATA</span>
       Restricted to department heads and HR. Handle per the data-protection policy. Do not forward.</div>`
    : ''

  const truncated = input.rowCountTotal !== undefined && input.rowCountTotal > input.rows.length
    ? `<div class="truncated">Showing ${nf.format(input.rows.length)} of ${nf.format(input.rowCountTotal)} rows.</div>`
    : ''

  return `<!doctype html>
<html lang="en" dir="${dir}">
<head>
<meta charset="utf-8">
<title>${escapeHtml(input.title)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Inter', 'Segoe UI', system-ui, -apple-system, 'Noto Naskh Arabic', 'Noto Sans Arabic', sans-serif;
         color: ${TOKENS.ink}; margin: 0; font-size: 11px;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .mono, .mono-cell, .bar-value { font-family: 'JetBrains Mono', ui-monospace, 'Cascadia Mono', Menlo, monospace; font-size: 10.5px; }
  .faint { color: ${TOKENS.faint}; }
  .head { display: flex; justify-content: space-between; align-items: flex-end;
          border-bottom: 2px solid ${TOKENS.accent}; padding-bottom: 8px; margin-bottom: 12px; }
  .title { font-family: 'Space Grotesk', 'Inter', system-ui, sans-serif; font-size: 20px; font-weight: 700; margin: 0; }
  .subtitle { color: ${TOKENS.muted}; font-size: 11px; margin-top: 2px; }
  .meta { text-align: ${metaAlign}; color: ${TOKENS.faint}; font-size: 10px; }
  .brand { font-weight: 700; color: ${TOKENS.accent}; letter-spacing: .04em; }
  .pd-banner { background: ${tint(TOKENS.red, 8)}; border: 1px solid ${tint(TOKENS.red, 25)}; border-radius: 6px;
               padding: 7px 10px; margin: 0 0 12px; font-size: 10.5px; color: ${TOKENS.ink}; }
  .pd-badge { background: ${TOKENS.red}; color: #fff; font-family: 'JetBrains Mono', monospace; font-size: 10px;
              padding: 2px 6px; border-radius: 4px; margin-right: 8px; font-weight: 600; }
  .kpis { display: flex; gap: 36px; padding: 6px 0 10px; border-bottom: 1px solid ${TOKENS.rowLine}; margin-bottom: 12px; }
  .kpi-value { font-family: 'Space Grotesk', 'Inter', sans-serif; font-size: 24px; font-weight: 700; }
  .kpi-label { font-size: 10px; text-transform: uppercase; letter-spacing: .05em; color: ${TOKENS.faint}; margin-top: 1px; }
  .bars { margin: 0 0 14px; display: flex; flex-direction: column; gap: 5px; }
  .bar-row { display: flex; align-items: center; gap: 10px; }
  .bar-label { width: 110px; font-size: 10.5px; color: ${TOKENS.muted}; }
  .bar-track { flex: 1; background: ${TOKENS.surface}; border-radius: 3px; height: 16px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 3px; }
  .bar-value { width: 64px; text-align: right; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  thead th { text-align: ${align}; background: ${TOKENS.surface}; color: #3a3d45; font-weight: 600;
             font-size: 10px; text-transform: uppercase; letter-spacing: .04em;
             padding: 6px 8px; border-bottom: 1px solid ${TOKENS.line}; white-space: nowrap; }
  thead th.num { text-align: right; }
  tbody td { padding: 6px 8px; border-bottom: 1px solid ${TOKENS.rowLine}; vertical-align: top; }
  tbody tr:nth-child(even) td { background: ${TOKENS.zebra}; }
  td.num { text-align: right; }
  tr.totals td { font-weight: 700; border-top: 1px solid ${TOKENS.line}; border-bottom: 0; }
  td.empty { text-align: center; color: ${TOKENS.faint}; padding: 24px; font-style: italic; }
  .chip { display: inline-block; font-family: 'JetBrains Mono', monospace; font-size: 10px; font-weight: 600;
          padding: 2px 6px; border-radius: 4px; }
  .truncated { margin-top: 8px; font-size: 10px; color: ${TOKENS.faint}; }
</style>
</head>
<body>
  <div class="head">
    <div>
      <h1 class="title">${escapeHtml(input.title)}</h1>
      ${input.subtitle ? `<div class="subtitle">${escapeHtml(input.subtitle)}</div>` : ''}
    </div>
    <div class="meta">
      <div class="brand">ABC CORP · SERVICES HUB</div>
      <div>Generated ${escapeHtml(generatedAt)} (Asia/Riyadh)${input.runBy ? ` · Run by ${escapeHtml(input.runBy)}` : ''} · ${nf.format(totalRows)} rows</div>
    </div>
  </div>
  ${pdBanner}
  ${kpiBand}
  ${barBand}
  <table>
    <thead><tr>${head}</tr></thead>
    <tbody>${bodyRows}${totals}</tbody>
  </table>
  ${truncated}
  <!-- the per-page confidentiality footer + page numbers are printed by the
       worker via Chrome's footerTemplate (server.ts) -->
</body>
</html>`
}
